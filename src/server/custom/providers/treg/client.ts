import { z } from "zod";

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
  const response = z
    .object({
      error: z.unknown().optional(),
      result: z.object({
        data: z.record(z.string(), z.unknown()),
      }),
    })
    .parse(body);
  if (response.error != null) {
    throw new Error("treg provider returned an error");
  }
  const item = response.result.data;
  // Different Serpstat revisions may use different field names. Prefer no
  // number over an invented number when a known key is unavailable.
  return {
    provider: "serpstat-via-treg",
    target,
    backlinks: asCount(item.backlinks),
    referringDomains: asCount(item.referring_domains),
    authority: asCount(item.sersptat_domain_rank),
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
