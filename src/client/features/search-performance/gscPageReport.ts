import { sort } from "remeda";
import type { getGscPageDetail } from "@/serverFunctions/gscPageDetail";
import type { SerpResultItem } from "@/types/keywords";

type Detail = Extract<
  Awaited<ReturnType<typeof getGscPageDetail>>,
  { connected: true }
>;

/** Queries in the report: enough for analysis, small enough to paste. */
const REPORT_QUERY_LIMIT = 1000;

const pct = (value: number) => `${(value * 100).toFixed(2)}%`;
const cell = (value: string) => value.replace(/\|/g, "/").replace(/\n/g, " ");

/**
 * The page's full Search Console picture as one Markdown document, with
 * instructions for an AI assistant: paste it into ChatGPT for an analysis.
 */
export function buildPageReport(
  page: string,
  detail: Detail,
  serp: { keyword: string; items: SerpResultItem[] } | null,
): string {
  const index = detail.inspection?.result?.indexStatusResult ?? {};
  const clicks = detail.queries.reduce((sum, row) => sum + row.clicks, 0);
  const impressions = detail.queries.reduce(
    (sum, row) => sum + row.impressions,
    0,
  );
  const position = impressions
    ? detail.queries.reduce(
        (sum, row) => sum + row.position * row.impressions,
        0,
      ) / impressions
    : 0;
  const queries = sort(
    detail.queries,
    (a, b) => b.impressions - a.impressions,
  ).slice(0, REPORT_QUERY_LIMIT);

  const lines = [
    "You are a senior SEO analyst. Analyse the Google Search Console data below for one page and give:",
    "1. A short diagnosis of how the page performs and why.",
    "2. The 5 highest-impact quick wins (titles, meta description, headings, content sections).",
    "3. Queries with high impressions but low CTR or a position of 5-20, and what to change to win them.",
    "4. Missing subtopics or questions the page should cover, based on the queries.",
    "5. Any indexing, canonical, sitemap or cannibalisation problems.",
    "6. A new title tag (under 60 characters) and meta description (under 155 characters).",
    "",
    `# Page: ${page}`,
    "",
    "## Health in Google (URL Inspection)",
    `- Index verdict: ${index.verdict ?? "unknown"} (${index.coverageState ?? "-"})`,
    `- Indexing: ${index.indexingState ?? "-"}; robots.txt: ${index.robotsTxtState ?? "-"}; page fetch: ${index.pageFetchState ?? "-"}`,
    `- Last crawl: ${index.lastCrawlTime ?? "never"} (${index.crawledAs ?? "-"})`,
    `- Google-selected canonical: ${index.googleCanonical ?? "-"}`,
    `- Declared canonical: ${index.userCanonical ?? "-"}`,
    `- In sitemaps: ${index.sitemap?.join(", ") || "none"}`,
    `- Referring pages Google knows: ${index.referringUrls?.length ?? 0}`,
    `- Rich results: ${detail.inspection?.result?.richResultsResult?.verdict ?? "-"}`,
    detail.inspection?.error
      ? `- Inspection error: ${detail.inspection.error}`
      : "",
    "",
    `## Search performance (${detail.range.startDate} to ${detail.range.endDate})`,
    `- Queries: ${detail.queryCount}${detail.queriesCapped ? "+" : ""}`,
    `- Clicks: ${clicks}`,
    `- Impressions: ${impressions}`,
    `- CTR: ${pct(impressions ? clicks / impressions : 0)}`,
    `- Average position: ${position.toFixed(1)}`,
    "",
    "## Queries per month (last 12 months)",
    "| Month | Queries | Clicks | Impressions |",
    "|---|---|---|---|",
    ...detail.months.map(
      (month) =>
        `| ${month.month}${month.partial ? " (so far)" : ""} | ${month.queries}${month.capped ? "+" : ""} | ${month.clicks} | ${month.impressions} |`,
    ),
    "",
  ];

  if (serp && serp.items.length) {
    lines.push(
      `## Live Google results for "${serp.keyword}"`,
      "| Rank | Domain | Title | URL |",
      "|---|---|---|---|",
      ...serp.items.map(
        (item) =>
          `| ${item.rank} | ${cell(item.domain)} | ${cell(item.title)} | ${item.url} |`,
      ),
      "",
    );
  }

  lines.push(
    `## Queries (${queries.length} of ${detail.queryCount}, most impressions first)`,
    "| Query | Clicks | Impressions | CTR | Position |",
    "|---|---|---|---|---|",
    ...queries.map(
      (row) =>
        `| ${cell(row.query)} | ${row.clicks} | ${row.impressions} | ${pct(row.ctr)} | ${row.position.toFixed(1)} |`,
    ),
  );
  return lines
    .filter((line, i, all) => line !== "" || all[i - 1] !== "")
    .join("\n");
}
