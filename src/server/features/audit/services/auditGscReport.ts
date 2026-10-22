import { env } from "cloudflare:workers";

/**
 * Search Console enrichment for site-audit results: 28-day clicks and
 * impressions per page, Google index status from the sitemap monitor, and
 * report-time issues derived from both. Everything is best-effort — a
 * missing GSC connection or empty coverage never fails the audit view.
 */

type IndexEntry = { i: boolean | null; r: string };

export type GscReportIssue = {
  id: string;
  auditId: string;
  pageId: string | null;
  pageUrl: string;
  issueType: string;
  severity: "critical" | "warning" | "info";
  detailsJson: string | null;
};

/** Normalize audit, GSC and sitemap URLs to the same key: ignore protocol
 * (http vs https), www vs apex, and a trailing slash. Query params are kept
 * sorted; fragments are dropped. */
export function normalizeAuditUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    parsed.protocol = "https:";
    parsed.searchParams.sort();
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

/** Index-coverage status labels, matching the sitemap index-coverage page. */
export function indexStatusOf(entry: IndexEntry | undefined) {
  if (!entry) return "Not checked";
  if (entry.i === true) return "Indexed";
  if (entry.i === false) return "Not indexed";
  return "Check failed";
}

/** Fetch page-dimension Search Console rows and index them by normalized URL,
 * summing duplicates. Returns an empty map when GSC is not connected. */
async function getGscPageMetrics(
  projectId: string,
  pageCount: number,
): Promise<Map<string, { clicks: number; impressions: number }>> {
  const { GscService } = await import(
    "@/server/features/gsc/services/GscService"
  );
  const rowLimit = Math.min(25000, Math.max(1000, pageCount));
  const { rows } = await GscService.getPerformance({
    projectId,
    dimensions: ["page"],
    dateRange: "last_28_days",
    rowLimit,
  });
  const metrics = new Map<string, { clicks: number; impressions: number }>();
  for (const row of rows) {
    const pageUrl = row.keys?.[0];
    if (!pageUrl) continue;
    const key = normalizeAuditUrl(pageUrl);
    if (!key) continue;
    const existing = metrics.get(key);
    if (existing) {
      existing.clicks += row.clicks;
      existing.impressions += row.impressions;
    } else {
      metrics.set(key, { clicks: row.clicks, impressions: row.impressions });
    }
  }
  return metrics;
}

/** Report-time Search Console issues: not-indexed pages (with Google's
 * reason), zero-click pages and weak pages. High-traffic pages that Google
 * won't index are critical; the rest follow the category severity. */
function buildGscReportIssues(
  auditId: string,
  pages: Array<{
    id: string;
    url: string;
    gscClicks: number | null;
    gscImpressions: number | null;
    gscIndexStatus: string;
    gscIndexReason: string | null;
  }>,
): GscReportIssue[] {
  const found: GscReportIssue[] = [];
  for (const page of pages) {
    const base = {
      auditId,
      pageId: page.id,
      pageUrl: page.url,
    };
    if (page.gscIndexStatus === "Not indexed") {
      const valuable = (page.gscClicks ?? 0) >= 500;
      found.push({
        ...base,
        id: `gsc-index-${page.id}`,
        issueType: valuable ? "gsc-valuable-not-indexed" : "gsc-not-indexed",
        severity: valuable ? "critical" : "warning",
        detailsJson: JSON.stringify({
          reason: page.gscIndexReason,
          clicks: page.gscClicks,
          impressions: page.gscImpressions,
        }),
      });
      // A not-indexed page's clicks are stale or absent — one issue is enough.
      continue;
    }
    if (page.gscClicks == null) continue;
    if (page.gscClicks === 0) {
      found.push({
        ...base,
        id: `gsc-dead-${page.id}`,
        issueType: "gsc-zero-click",
        severity: "warning",
        detailsJson: JSON.stringify({ impressions: page.gscImpressions }),
      });
    } else if (page.gscClicks < 100) {
      found.push({
        ...base,
        id: `gsc-weak-${page.id}`,
        issueType: "gsc-weak-click",
        severity: "info",
        detailsJson: JSON.stringify({
          clicks: page.gscClicks,
          impressions: page.gscImpressions,
        }),
      });
    }
  }
  return found;
}

/** Fetch page×query Search Console rows and keep each page's top query by
 * impressions and by clicks. Returns an empty map when GSC is not connected. */
async function getGscTopQueries(
  projectId: string,
  pageCount: number,
): Promise<
  Map<
    string,
    {
      impQuery: string;
      impressions: number;
      clickQuery: string;
      clicks: number;
    }
  >
> {
  const { GscService } = await import(
    "@/server/features/gsc/services/GscService"
  );
  // One row per page×query pair, so the limit scales with the audit size.
  const rowLimit = Math.min(25000, Math.max(5000, pageCount * 200));
  const { rows } = await GscService.getPerformance({
    projectId,
    dimensions: ["page", "query"],
    dateRange: "last_28_days",
    rowLimit,
  });
  const top = new Map<
    string,
    {
      impQuery: string;
      impressions: number;
      clickQuery: string;
      clicks: number;
    }
  >();
  for (const row of rows) {
    const pageUrl = row.keys?.[0];
    const query = row.keys?.[1];
    if (!pageUrl || !query) continue;
    const key = normalizeAuditUrl(pageUrl);
    if (!key) continue;
    const existing = top.get(key);
    if (!existing) {
      top.set(key, {
        impQuery: query,
        impressions: row.impressions,
        clickQuery: query,
        clicks: row.clicks,
      });
    } else {
      if (row.impressions > existing.impressions) {
        existing.impQuery = query;
        existing.impressions = row.impressions;
      }
      if (row.clicks > existing.clicks) {
        existing.clickQuery = query;
        existing.clicks = row.clicks;
      }
    }
  }
  return top;
}

/**
 * Attach 28-day GSC clicks/impressions, Google index status and the derived
 * report-time issues to crawled pages. Computed when results load so past
 * audits gain them without a re-crawl; nothing is persisted.
 */
export async function enrichAuditPagesWithGsc<
  TPage extends { id: string; url: string },
>(
  projectId: string,
  auditId: string,
  pages: TPage[],
): Promise<{
  pages: Array<
    TPage & {
      gscClicks: number | null;
      gscImpressions: number | null;
      gscTopImpressionQuery: string | null;
      gscTopImpressions: number | null;
      gscTopClickQuery: string | null;
      gscTopClicks: number | null;
      gscIndexStatus: string;
      gscIndexReason: string | null;
    }
  >;
  issues: GscReportIssue[];
  gscConnected: boolean;
}> {
  // Best-effort Search Console page metrics (last 28 days). A missing
  // connection, revoked grant or API failure leaves nulls, shown as
  // "No clicks" / "No impression".
  let gscMetrics = new Map<string, { clicks: number; impressions: number }>();
  let gscConnected = false;
  try {
    gscMetrics = await getGscPageMetrics(projectId, pages.length);
    gscConnected = true;
  } catch (error) {
    console.warn(`Audit ${auditId}: GSC page metrics unavailable:`, error);
  }

  // Best-effort top queries per page (last 28 days). Failing independently
  // of the page totals so one bad call cannot take down the other.
  let gscTopQueries: Awaited<ReturnType<typeof getGscTopQueries>> = new Map();
  try {
    gscTopQueries = await getGscTopQueries(projectId, pages.length);
    gscConnected = true;
  } catch (error) {
    console.warn(`Audit ${auditId}: GSC top queries unavailable:`, error);
  }

  // Best-effort Google index status from the sitemap monitor (KV-only,
  // keyed by sitemap URL). Missing coverage shows "Not checked".
  let indexEntries: Record<string, IndexEntry> = {};
  try {
    const { readResults } = await import(
      "@/server/custom/sitemaps/indexCoverageStore"
    );
    indexEntries = await readResults(env.KV, projectId);
  } catch (error) {
    console.warn(`Audit ${auditId}: index coverage unavailable:`, error);
  }
  const indexByNormalized = new Map<string, IndexEntry>();
  for (const [rawUrl, entry] of Object.entries(indexEntries)) {
    const normalized = normalizeAuditUrl(rawUrl);
    if (normalized && !indexByNormalized.has(normalized)) {
      indexByNormalized.set(normalized, entry);
    }
  }

  const enriched = pages.map((page) => {
    const key = normalizeAuditUrl(page.url);
    const metrics = key ? gscMetrics.get(key) : undefined;
    const queries = key ? gscTopQueries.get(key) : undefined;
    const indexEntry =
      indexEntries[page.url] ?? (key ? indexByNormalized.get(key) : undefined);
    return {
      ...page,
      gscClicks: metrics?.clicks ?? null,
      gscImpressions: metrics?.impressions ?? null,
      gscTopImpressionQuery: queries?.impQuery ?? null,
      gscTopImpressions: queries?.impressions ?? null,
      gscTopClickQuery: queries?.clickQuery ?? null,
      gscTopClicks: queries?.clicks ?? null,
      gscIndexStatus: indexStatusOf(indexEntry),
      gscIndexReason: indexEntry?.r ?? null,
    };
  });

  return {
    pages: enriched,
    issues: buildGscReportIssues(auditId, enriched),
    gscConnected,
  };
}
