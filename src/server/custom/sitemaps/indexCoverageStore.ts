import { sort } from "remeda";
import { z } from "zod";
import { GscApiError, GscTokenError } from "@/server/lib/gscErrors";
import type { UrlInspectionResult } from "@/server/lib/gscClient";

/**
 * Google index coverage for sitemap-listed URLs, via the Search Console URL
 * Inspection API. Google allows 2,000 inspections per property per day; this
 * stays at DAILY_LIMIT so manual inspections in Search Console still work.
 * Cron ticks inspect small batches (TICK_LIMIT) to stay within Worker
 * subrequest limits. KV-only: no database imports, because the sitemap server
 * functions (bundled for the client too) import this module.
 */
export const DAILY_LIMIT = 500;
export const TICK_LIMIT = 20;
const RECHECK_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const CONCURRENCY = 4;

const urlsKey = (id: string) => `custom:sitemaps:urls:${id}`;
const resultsKey = (id: string) => `custom:sitemaps:index:${id}`;
const stateKey = (id: string) => `custom:sitemaps:index-state:${id}`;

const entrySchema = z.object({
  // true = indexed, false = not indexed, null = inspection failed
  i: z.boolean().nullable(),
  r: z.string(),
  c: z.string().optional(),
  t: z.string(),
});
const resultsSchema = z.record(z.string(), entrySchema);
const stateSchema = z.object({
  day: z.string(),
  used: z.number(),
  lastRunAt: z.string().nullable(),
  lastError: z.string().nullable(),
});

type IndexEntry = z.infer<typeof entrySchema>;
type IndexResults = z.infer<typeof resultsSchema>;
type IndexState = z.infer<typeof stateSchema>;
export type Inspect = (url: string) => Promise<UrlInspectionResult | null>;
/** The KV operations used per project (Env["KV"] satisfies it). */
type ProjectKv = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
};

const today = (now: Date) => now.toISOString().slice(0, 10);

/** PASS is Google's "URL is on Google"; NEUTRAL/FAIL are not indexed. */
export function classifyInspection(
  result: UrlInspectionResult | null,
  now: Date,
): IndexEntry {
  const status = result?.indexStatusResult;
  return {
    i: status?.verdict === "PASS",
    r: status?.coverageState ?? status?.verdict ?? "Unknown to Google",
    ...(status?.lastCrawlTime ? { c: status.lastCrawlTime } : {}),
    t: now.toISOString(),
  };
}

/** Unchecked URLs first (sitemap order), then the stalest re-checks. */
export function pickBatch(
  urls: string[],
  results: IndexResults,
  limit: number,
  now: Date,
): string[] {
  if (limit <= 0) return [];
  const unchecked = urls.filter((url) => !results[url]);
  if (unchecked.length >= limit) return unchecked.slice(0, limit);
  const stale = sort(
    urls.filter((url) => {
      const entry = results[url];
      return entry && now.getTime() - Date.parse(entry.t) >= RECHECK_AFTER_MS;
    }),
    (a, b) => Date.parse(results[a].t) - Date.parse(results[b].t),
  );
  return [...unchecked, ...stale].slice(0, limit);
}

export function summarizeCoverage(urls: string[], results: IndexResults) {
  let indexed = 0;
  let notIndexed = 0;
  let failed = 0;
  const reasons = new Map<string, number>();
  for (const url of urls) {
    const entry = results[url];
    if (!entry) continue;
    if (entry.i === true) indexed++;
    else if (entry.i === false) {
      notIndexed++;
      reasons.set(entry.r, (reasons.get(entry.r) ?? 0) + 1);
    } else failed++;
  }
  return {
    totalUrls: urls.length,
    indexed,
    notIndexed,
    failed,
    notChecked: urls.length - indexed - notIndexed - failed,
    reasons: sort(
      [...reasons].map(([reason, count]) => ({ reason, count })),
      (a, b) => b.count - a.count,
    ),
  };
}

async function readJson<T>(
  kv: ProjectKv,
  key: string,
  schema: z.ZodType<T>,
  fallback: T,
): Promise<T> {
  const raw = await kv.get(key);
  return raw ? schema.parse(JSON.parse(raw) as unknown) : fallback;
}

export const readUrls = (kv: ProjectKv, id: string) =>
  readJson(kv, urlsKey(id), z.array(z.string()), []);
export const readResults = (kv: ProjectKv, id: string) =>
  readJson(kv, resultsKey(id), resultsSchema, {});
export async function readState(
  kv: ProjectKv,
  id: string,
  now: Date,
): Promise<IndexState> {
  const state = await readJson<IndexState | null>(
    kv,
    stateKey(id),
    stateSchema,
    null,
  );
  if (!state)
    return { day: today(now), used: 0, lastRunAt: null, lastError: null };
  // The daily counter resets at UTC midnight.
  return state.day === today(now)
    ? state
    : { ...state, day: today(now), used: 0 };
}

/** Store the latest sitemap URL list and drop results for removed URLs. */
export async function saveSitemapUrls(
  kv: ProjectKv,
  id: string,
  urls: string[],
): Promise<void> {
  await kv.put(urlsKey(id), JSON.stringify(urls));
  const results = await readResults(kv, id);
  const keep = new Set(urls);
  const pruned = Object.fromEntries(
    Object.entries(results).filter(([url]) => keep.has(url)),
  );
  if (Object.keys(pruned).length !== Object.keys(results).length)
    await kv.put(resultsKey(id), JSON.stringify(pruned));
}

type BatchOutcome = {
  inspected: number;
  /** Google throttled the requests; stop all projects for this run. */
  rateLimited: boolean;
  error: string | null;
};

/** Inspect up to `max` URLs for one project, respecting the daily limit. */
export async function inspectBatch(
  kv: ProjectKv,
  id: string,
  max: number,
  inspect: Inspect,
  now = new Date(),
): Promise<BatchOutcome> {
  const state = await readState(kv, id, now);
  const allowance = Math.min(max, DAILY_LIMIT - state.used);
  const urls = await readUrls(kv, id);
  const results = await readResults(kv, id);
  const batch = pickBatch(urls, results, allowance, now);
  if (batch.length === 0)
    return { inspected: 0, rateLimited: false, error: null };

  let attempted = 0;
  let stopError: string | null = null;
  let rateLimited = false;
  const queue = [...batch];
  async function worker() {
    while (queue.length && !stopError) {
      const url = queue.shift();
      if (!url) return;
      attempted++;
      try {
        results[url] = classifyInspection(await inspect(url), now);
      } catch (error) {
        if (error instanceof GscTokenError) {
          stopError =
            "The Search Console connection has expired. Reconnect it in Integrations.";
        } else if (error instanceof GscApiError && error.status === 429) {
          rateLimited = true;
          stopError = "Search Console rate limit reached; will retry later.";
        } else if (
          error instanceof GscApiError &&
          (error.status === 401 || error.status === 403)
        ) {
          stopError =
            "Search Console denied the inspection. Check that the sitemap URLs belong to the connected Search Console property.";
        } else if (error instanceof GscApiError && error.status >= 500) {
          stopError = "Search Console is temporarily unavailable.";
        } else {
          results[url] = {
            i: null,
            r:
              error instanceof GscApiError
                ? `Inspection failed (HTTP ${error.status})`
                : "Inspection failed",
            t: now.toISOString(),
          };
        }
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  await kv.put(resultsKey(id), JSON.stringify(results));
  await kv.put(
    stateKey(id),
    JSON.stringify({
      ...state,
      used: state.used + attempted,
      lastRunAt: now.toISOString(),
      lastError: stopError,
    } satisfies IndexState),
  );
  return { inspected: attempted, rateLimited, error: stopError };
}
