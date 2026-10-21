/**
 * Isolated treg transport. Never expose TREG_API_TOKEN to browser code.
 * Calls are opt-in and are NEVER retried automatically (provider may charge).
 */
const TREG_BACKLINKS_ENDPOINT = "serpstat.web.backlinks.summary";
const TREG_BACKLINKS_ESTIMATED_USD = 0.0025;

type TregBacklinksSummary = {
  provider: "serpstat-via-treg";
  target: string;
  backlinks: number | null;
  referringDomains: number | null;
  authority: number | null;
  fetchedAt: string;
  estimatedCostUsd: number;
};

type TregRequestOptions = {
  token: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
};

function asCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

export function parseSerpstatBacklinksSummary(
  body: unknown,
  target: string,
  now = new Date(),
): TregBacklinksSummary {
  if (typeof body !== "object" || body === null) {
    throw new Error("Invalid treg backlink response");
  }
  const response = body as Record<string, unknown>;
  if (response.error != null) {
    throw new Error("treg provider returned an error");
  }
  const result = response.result;
  if (typeof result !== "object" || result === null) {
    throw new Error("Missing provider result");
  }
  const data = (result as Record<string, unknown>).data;
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("Invalid Serpstat backlink summary data");
  }
  const item = data as Record<string, unknown>;
  // Different Serpstat revisions may use different field names. Prefer no
  // number over an invented number when a known key is unavailable.
  return {
    provider: "serpstat-via-treg",
    target,
    backlinks: asCount(item.externalLinks ?? item.external_links),
    referringDomains: asCount(item.referringDomains ?? item.referring_domains),
    authority: asCount(item.sdr ?? item.SDR),
    fetchedAt: now.toISOString(),
    estimatedCostUsd: TREG_BACKLINKS_ESTIMATED_USD,
  };
}

export async function fetchTregBacklinksSummary(
  target: string,
  options: TregRequestOptions,
): Promise<TregBacklinksSummary> {
  if (
    !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(target)
  ) {
    throw new Error("treg backlink pilot accepts a bare domain only");
  }
  if (!options.token) throw new Error("Missing treg token");
  const response = await (options.fetchImpl ?? fetch)(
    `https://treg.to/call/${TREG_BACKLINKS_ENDPOINT}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Treg-Token": options.token,
      },
      body: JSON.stringify({
        method: "SerpstatBacklinksProcedure.getSummaryV2",
        id: "1",
        params: { query: target, searchType: "domain" },
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok)
    throw new Error(`treg request failed (HTTP ${response.status})`);
  return parseSerpstatBacklinksSummary(
    await response.json(),
    target,
    options.now?.() ?? new Date(),
  );
}

