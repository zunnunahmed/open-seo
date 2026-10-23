import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Network } from "lucide-react";
import { Button } from "@/client/components/ui/button";
import { Card } from "@/client/components/ui/card";
import { DataSourceLabel } from "@/client/features/integrations/DataSourceLabel";
import { getDomainKeywordsPage } from "@/serverFunctions/domain";
import { createClusterJob } from "@/serverFunctions/keywordClustering";
import { getLanguageCode } from "@/shared/keyword-locations";
import { MAX_CLUSTER_KEYWORDS } from "@/shared/keywordClustering";
import { domainField } from "@/types/schemas/domain";

const PAGE_SIZE = 200;

/**
 * Cluster the keywords a competitor ranks for: pull its ranked keywords
 * (highest volume first) from the project's SEO data source, then hand them to
 * Keyword Clustering, which groups keywords sharing Google top-10 results. The
 * clustering job opens as a draft with its cost estimate; nothing past the
 * keyword list is spent until the user starts it there.
 */
export function CompetitorKeywordClusterCard({
  projectId,
  domain,
  market,
  approved,
}: {
  projectId: string;
  domain: string;
  market: number;
  approved: boolean;
}) {
  const navigate = useNavigate();
  const [fetched, setFetched] = useState(0);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    const host = domainField.safeParse(domain);
    if (!host.success) {
      setError("Enter a valid competitor website above.");
      return;
    }
    if (!approved) {
      setError("Tick the approval for chargeable SEO data requests above.");
      return;
    }
    setRunning(true);
    setError("");
    setFetched(0);
    try {
      const byKeyword = new Map<
        string,
        { keyword: string; volume: number | null; cpc: number | null }
      >();
      for (
        let page = 1;
        (page - 1) * PAGE_SIZE < MAX_CLUSTER_KEYWORDS;
        page += 1
      ) {
        const response = await getDomainKeywordsPage({
          data: {
            projectId,
            domain: host.data,
            scope: "subdomains",
            locationCode: market,
            page,
            pageSize: PAGE_SIZE,
            sortMode: "volume",
            sortOrder: "desc",
            filters: {},
          },
        });
        for (const row of response.keywords) {
          const key = row.keyword.trim().toLowerCase();
          if (key && !byKeyword.has(key))
            byKeyword.set(key, {
              keyword: row.keyword.trim(),
              volume: row.searchVolume,
              cpc: row.cpc,
            });
        }
        setFetched(byKeyword.size);
        if (!response.hasMore || response.keywords.length === 0) break;
      }
      const keywords = [...byKeyword.values()].slice(0, MAX_CLUSTER_KEYWORDS);
      if (keywords.length < 2) {
        setError(
          `${host.data} ranks for too few keywords in this market to cluster.`,
        );
        return;
      }
      const created = await createClusterJob({
        data: {
          projectId,
          name: `${host.data} keywords · ${keywords.length.toLocaleString()}`,
          keywords,
          fetchVolume: false,
          locationCode: market,
          languageCode: getLanguageCode(market),
        },
      });
      if (!created.ok) {
        setError(created.error);
        return;
      }
      await navigate({
        to: "/p/$projectId/keyword-clustering",
        params: { projectId },
        search: { job: created.job.id },
      });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not fetch keywords.",
      );
    } finally {
      setRunning(false);
    }
  }

  return (
    <Card className="space-y-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">
          Cluster the competitor&rsquo;s keywords
        </h2>
        <DataSourceLabel projectId={projectId} />
      </div>
      <p className="text-sm text-muted-foreground">
        Pulls up to {MAX_CLUSTER_KEYWORDS.toLocaleString()} keywords the
        competitor ranks for (highest search volume first) from your SEO data
        source, then groups them by shared Google top-10 results in Keyword
        Clustering. The keyword list costs about US$0.20 per 1,000 keywords
        through DataForSEO (about US$0.50 through Serpstat); clustering then
        shows its own estimate and waits for you to start it.
      </p>
      <Button
        variant="outline"
        disabled={running || !domain.trim()}
        onClick={() => void run()}
      >
        <Network className="size-4" />
        {running
          ? `Fetching keywords… ${fetched.toLocaleString()}`
          : "Cluster competitor keywords (paid)"}
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </Card>
  );
}
