import { buildCsv, type CsvValue } from "@/client/lib/csv";
import { downloadFile } from "@/client/lib/download";
import type { KeywordCluster } from "@/shared/keywordClustering";

export function featureLabel(feature: string) {
  return feature.replace(/_/g, " ");
}

function fileSlug(name: string) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "keyword-clusters"
  );
}

/** One row per keyword, including unclustered and failed keywords. */
export function exportKeywordsCsv(
  name: string,
  clusters: KeywordCluster[],
  failed: Array<{ keyword: string; error: string }>,
) {
  const rows: CsvValue[][] = clusters.flatMap((cluster) =>
    cluster.keywords.map((k) => [
      cluster.keywords.length > 1 ? cluster.main.keyword : "(unclustered)",
      k.keyword,
      k.keyword === cluster.main.keyword ? "yes" : "",
      k.volume,
      k.cpc,
      cluster.keywords.length,
      cluster.totalVolume,
      cluster.pageType,
      cluster.sharedUrls.slice(0, 5).join(" | "),
      cluster.ownUrls.join(" | "),
    ]),
  );
  for (const f of failed)
    rows.push([
      "(no SERP data)",
      f.keyword,
      "",
      null,
      null,
      0,
      0,
      "",
      f.error,
      "",
    ]);
  downloadFile(
    buildCsv(
      [
        "Cluster",
        "Keyword",
        "Main keyword",
        "Volume",
        "CPC",
        "Cluster size",
        "Cluster volume",
        "Page type",
        "Shared URLs",
        "Your URLs",
      ],
      rows,
    ),
    `${fileSlug(name)}-keywords.csv`,
    "text/csv",
  );
}

/** One row per cluster of two or more keywords. */
export function exportClustersCsv(name: string, clusters: KeywordCluster[]) {
  downloadFile(
    buildCsv(
      [
        "Main keyword",
        "Keywords",
        "Cluster volume",
        "Page type",
        "SERP features",
        "Top domains",
        "Shared URLs",
        "Your URLs",
        "Member keywords",
      ],
      clusters.map((c) => [
        c.main.keyword,
        c.keywords.length,
        c.totalVolume,
        c.pageType,
        c.features.map(featureLabel).join(", "),
        c.topDomains.map((d) => d.domain).join(", "),
        c.sharedUrls.slice(0, 5).join(" | "),
        c.ownUrls.join(" | "),
        c.keywords.map((k) => k.keyword).join(", "),
      ]),
    ),
    `${fileSlug(name)}-clusters.csv`,
    "text/csv",
  );
}
