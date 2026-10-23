import { AsyncLocalStorage } from "node:async_hooks";
import { AppError } from "@/server/lib/errors";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";

/**
 * Per-project SEO data route. treg relays DataForSEO's own request and
 * response unchanged, so "treg_dataforseo" swaps only the transport: every
 * parser, cache and UI keeps working on the same payload. A route never falls
 * back to another provider; a request it cannot serve fails with
 * PROVIDER_ROUTE_UNSUPPORTED.
 */
export type SeoProviderRoute =
  | "direct_dataforseo"
  | "treg_serpstat"
  | "treg_dataforseo";

const routeStore = new AsyncLocalStorage<SeoProviderRoute>();

export function runWithSeoProviderRoute<T>(
  route: SeoProviderRoute,
  fn: () => T,
): T {
  return routeStore.run(route, fn);
}

/** The route of the current request; direct when none was set. */
export function activeSeoProviderRoute(): SeoProviderRoute {
  return routeStore.getStore() ?? "direct_dataforseo";
}

/** DataForSEO live paths treg serves, keyed by the path the app requests. */
const TREG_DATAFORSEO_ENDPOINTS: Record<string, string> = {
  "/v3/dataforseo_labs/google/related_keywords/live":
    "dataforseo.google.keywords.ideas",
  "/v3/dataforseo_labs/google/keyword_suggestions/live":
    "dataforseo.x.dataforseo-labs-google-keyword-suggestions-live",
  "/v3/dataforseo_labs/google/keyword_ideas/live":
    "dataforseo.x.dataforseo-labs-google-keyword-ideas-live",
  "/v3/dataforseo_labs/google/keyword_overview/live":
    "dataforseo.x.dataforseo-labs-google-keyword-overview-live",
  "/v3/dataforseo_labs/google/domain_rank_overview/live":
    "dataforseo.x.dataforseo-labs-google-domain-rank-overview-live",
  "/v3/dataforseo_labs/google/ranked_keywords/live":
    "dataforseo.google.domain.ranked_keywords",
  "/v3/dataforseo_labs/google/relevant_pages/live":
    "dataforseo.x.dataforseo-labs-google-relevant-pages-live",
  "/v3/dataforseo_labs/google/serp_competitors/live":
    "dataforseo.x.dataforseo-labs-google-serp-competitors-live",
  "/v3/keywords_data/google_ads/search_volume/live":
    "dataforseo.google.keywords.volume",
  "/v3/keywords_data/google_ads/keywords_for_keywords/live":
    "dataforseo.x.keywords-data-google-ads-keywords-for-keywords-live",
  "/v3/serp/google/organic/live/advanced":
    "dataforseo.x.serp-google-organic-live-advanced",
  "/v3/serp/google/autocomplete/live/advanced":
    "dataforseo.x.serp-google-autocomplete-live-advanced",
  "/v3/backlinks/summary/live": "dataforseo.web.backlinks.summary",
  "/v3/backlinks/backlinks/live": "dataforseo.web.backlinks.list",
  "/v3/backlinks/referring_domains/live": "dataforseo.web.linking_domains.list",
  "/v3/backlinks/domain_pages_summary/live":
    "dataforseo.x.backlinks-domain-pages-summary-live",
  "/v3/backlinks/history/live": "dataforseo.x.backlinks-history-live",
};

/** Throws unless treg is enabled and has a token on this deployment. */
async function requireTregToken(): Promise<string> {
  if ((await getOptionalEnvValue("CUSTOM_TREG_ENABLED")) !== "true") {
    throw new AppError(
      "TREG_REQUEST_FAILED",
      "treg is not enabled on this deployment (CUSTOM_TREG_ENABLED)",
    );
  }
  const token = await getOptionalEnvValue("TREG_API_TOKEN");
  if (!token) {
    throw new AppError("TREG_REQUEST_FAILED", "TREG_API_TOKEN is not set");
  }
  return token;
}

/**
 * POST to one treg catalog endpoint. Never retried: treg bills per call, and a
 * failed response does not prove the provider skipped the charge.
 */
export function postToTreg(
  endpointId: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  return sendToTreg(endpointId, { method: "POST", body, signal });
}

/** GET a treg catalog endpoint whose provider takes query parameters. */
export function getFromTreg(
  endpointId: string,
  query: Record<string, string | number | boolean>,
  signal?: AbortSignal,
): Promise<Response> {
  return sendToTreg(endpointId, { method: "GET", query, signal });
}

async function sendToTreg(
  endpointId: string,
  request: {
    method: "GET" | "POST";
    body?: unknown;
    query?: Record<string, string | number | boolean>;
    signal?: AbortSignal;
  },
): Promise<Response> {
  const token = await requireTregToken();
  const url = new URL(`https://treg.to/call/${endpointId}`);
  for (const [key, value] of Object.entries(request.query ?? {}))
    url.searchParams.set(key, String(value));
  let response: Response;
  try {
    response = await fetch(url.href, {
      method: request.method,
      headers: {
        Accept: "application/json",
        ...(request.method === "POST"
          ? { "Content-Type": "application/json" }
          : {}),
        "X-Treg-Token": token,
      },
      body:
        request.method === "POST" ? JSON.stringify(request.body) : undefined,
      signal: request.signal ?? AbortSignal.timeout(60_000),
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    ) {
      throw new AppError(
        "UPSTREAM_UNAVAILABLE",
        `treg request timed out on ${endpointId}`,
        { provider: "treg", providerPath: endpointId },
      );
    }
    throw error;
  }
  if (response.ok) return response;
  const text = (await response.text()).slice(0, 1600);
  console.warn("treg.request-failed", {
    endpointId,
    status: response.status,
  });
  throw new AppError(
    response.status === 429
      ? "RATE_LIMITED"
      : response.status >= 500
        ? "UPSTREAM_UNAVAILABLE"
        : "TREG_REQUEST_FAILED",
    `treg HTTP ${response.status} on ${endpointId}`,
    {
      provider: "treg",
      providerStatus: String(response.status),
      providerPath: endpointId,
      responseBody: text,
    },
  );
}

/**
 * Send a DataForSEO request through treg's DataForSEO relay. Only the live
 * POST endpoints treg serves are allowed; queued task_post/task_get are not.
 */
export async function fetchDataforseoViaTreg(
  method: "GET" | "POST",
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  const endpointId =
    method === "POST" ? TREG_DATAFORSEO_ENDPOINTS[path] : undefined;
  if (!endpointId) {
    throw new AppError(
      "PROVIDER_ROUTE_UNSUPPORTED",
      `treg → DataForSEO cannot serve ${method} ${path}`,
    );
  }
  return postToTreg(endpointId, body, signal);
}
