import { z } from "zod";
import { sort } from "remeda";

/**
 * Call a treg-routed endpoint directly (raw Serpstat-procedure style is kept
 * in client.ts / lists.ts). Used for the treg → DataForSEO route: treg picks
 * the DataForSEO backend, and the request fails closed instead of silently
 * falling back to another provider.
 */

export type TregRouteName = "serpstat" | "dataforseo";

export type TregRoutedCall = {
  /** Raw `output` object from the routed response, shape varies by provider. */
  output: unknown;
  /** Provider that actually served the call, e.g. "dataforseo.web.backlinks.summary". */
  servedBy: string | null;
  /** Sum of per-attempt charges reported by treg, in USD. */
  chargedUsd: number;
};

type TregRoutedCallOptions = {
  token: string;
  /** Force a specific provider; combined with no-fallback so misses fail loudly. */
  prefer: TregRouteName;
  fetchImpl?: typeof fetch;
};

const triedItemSchema = z.object({
  endpoint_id: z.string().optional(),
  status: z.number().optional(),
  charged_micro: z.number().optional(),
  outcome: z.string().optional(),
});

const routedResponseSchema = z.object({
  error: z.unknown().optional(),
  output: z.unknown().optional(),
  _treg: z
    .object({
      served_by: z.string().nullable().optional(),
      tried: z.array(triedItemSchema).optional(),
    })
    .nullable()
    .optional(),
});

function sumChargedUsd(tried: z.infer<typeof triedItemSchema>[] | undefined): number {
  if (!tried) return 0;
  return tried.reduce((sum, attempt) => {
    const micro =
      typeof attempt.charged_micro === "number" &&
      Number.isFinite(attempt.charged_micro) &&
      attempt.charged_micro > 0
        ? attempt.charged_micro
        : 0;
    return sum + micro / 1_000_000;
  }, 0);
}

export async function callTregRouted(
  endpoint: string,
  body: unknown,
  options: TregRoutedCallOptions,
): Promise<TregRoutedCall> {
  const { token, prefer, fetchImpl = fetch } = options;
  if (!token) throw new Error("Missing treg token");
  const response = await fetchImpl(`https://treg.to/call/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Treg-Token": token,
      "X-Treg-Route-Prefer": prefer,
      // Do not silently fall through to another provider: the caller chose
      // this route explicitly, so a miss must fail loudly instead.
      "X-Treg-Route-Waterfall": "0",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`treg request failed (HTTP ${response.status})`);
  }
  const parsed = routedResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error("treg returned an unusable response");
  if (parsed.data.error != null) throw new Error("treg provider returned an error");
  return {
    output: parsed.data.output ?? null,
    servedBy: parsed.data._treg?.served_by ?? null,
    chargedUsd: sumChargedUsd(parsed.data._treg?.tried),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    record[key] = entry;
  }
  return record;
}

function asNonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Totales from a routed backlinks summary. Prefers the provider's own
 * summary block, falls back to top-level counts; never invents a number.
 */
export function parseRoutedSummary(output: unknown): {
  backlinks: number | null;
  referringDomains: number | null;
} {
  const root = asRecord(output);
  const nested = root ? asRecord(root.summary) : null;
  const backlinks =
    asNonNegativeNumber(nested?.backlinks) ??
    asNonNegativeNumber(root?.backlinks);
  const referringDomains =
    asNonNegativeNumber(nested?.referring_domains) ??
    asNonNegativeNumber(root?.referring_domains);
  return { backlinks, referringDomains };
}

export type TregRoutedBacklink = {
  source: string;
  target: string | null;
  anchor: string | null;
  /** "dofollow" | "nofollow" when the provider states it, else null. */
  linkType: string | null;
  firstSeen: string | null;
  authority: number | null;
};

/**
 * Normalize one routed backlinks row. `dofollow` is a boolean on the
 * DataForSEO shape; keep it as plain follow-status words, null when unknown.
 */
export function parseRoutedBacklinkRow(item: unknown): TregRoutedBacklink | null {
  const row = asRecord(item);
  if (!row) return null;
  const source = asNonEmptyString(row.url_from);
  if (!source) return null;
  const dofollow = row.dofollow;
  return {
    source,
    target: asNonEmptyString(row.url_to),
    anchor: asNonEmptyString(row.anchor),
    linkType:
      dofollow === true ? "dofollow" : dofollow === false ? "nofollow" : null,
    firstSeen: asNonEmptyString(row.first_seen),
    authority:
      asNonNegativeNumber(row.domain_inlink_rank) ??
      asNonNegativeNumber(row.inlink_rank),
  };
}

/** Raw backlink rows from a routed list call (empty when there are none). */
export function parseRoutedBacklinks(output: unknown): TregRoutedBacklink[] {
  const root = asRecord(output);
  const items = root && Array.isArray(root.backlinks) ? root.backlinks : [];
  return items.flatMap((item) => {
    const row = parseRoutedBacklinkRow(item);
    return row ? [row] : [];
  });
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return null;
  }
}

export type TregRoutedReferringDomain = {
  domain: string;
  linkCount: number;
  authority: number | null;
};

/**
 * Roll individual backlinks up to referring domains, most-linked first.
 * Authority is the best domain-level rank seen across the domain's sampled
 * links; unknown when the provider reports none.
 */
export function aggregateReferringDomains(
  rows: TregRoutedBacklink[],
  limit = 20,
): TregRoutedReferringDomain[] {
  const byDomain = new Map<string, { count: number; authority: number | null }>();
  for (const row of rows) {
    const domain = hostOf(row.source);
    if (!domain) continue;
    let entry = byDomain.get(domain);
    if (!entry) {
      entry = { count: 0, authority: null };
      byDomain.set(domain, entry);
    }
    entry.count += 1;
    if (row.authority != null) {
      entry.authority =
        entry.authority == null
          ? row.authority
          : Math.max(entry.authority, row.authority);
    }
  }
  return sort(
    [...byDomain.entries()].map(([domain, entry]) => ({
      domain,
      linkCount: entry.count,
      authority: entry.authority,
    })),
    (a, b) => b.linkCount - a.linkCount || a.domain.localeCompare(b.domain),
  ).slice(0, Math.max(1, limit));
}
