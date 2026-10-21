import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/client/components/ui/button";
import { buildCsv } from "@/client/lib/csv";
import { downloadFile } from "@/client/lib/download";
import {
  checkIndexCoverageNow,
  getIndexCoverage,
  listIndexCoverageRows,
} from "@/serverFunctions/indexCoverage";

/** Google index coverage of sitemap URLs (Search Console URL Inspection). */
export function IndexCoverageSummary({
  projectId,
  showActions = false,
}: {
  projectId: string;
  showActions?: boolean;
}) {
  const client = useQueryClient();
  const queryKey = ["indexCoverage", projectId];
  const query = useQuery({
    queryKey,
    queryFn: () => getIndexCoverage({ data: { projectId } }),
  });
  const check = useMutation({
    mutationFn: async () => {
      const result = await checkIndexCoverageNow({ data: { projectId } });
      if (!result.ok) throw new Error(result.error);
      return result;
    },
    onSettled: () => void client.invalidateQueries({ queryKey }),
  });
  const exportCsv = useMutation({
    mutationFn: async () => {
      const rows = await listIndexCoverageRows({ data: { projectId } });
      const csv = buildCsv(
        ["URL", "Status", "Reason", "Last crawl", "Checked at"],
        rows.map((r) => [r.url, r.status, r.reason, r.lastCrawl, r.checkedAt]),
      );
      downloadFile(csv, "sitemap-index-coverage.csv", "text/csv");
    },
  });

  if (query.isPending)
    return (
      <p className="text-sm text-muted-foreground">Loading index coverage…</p>
    );
  if (query.isError)
    return (
      <p className="text-sm text-destructive">Could not load index coverage.</p>
    );
  const data = query.data;

  if (!data.gscSiteUrl)
    return (
      <p className="text-sm text-muted-foreground">
        Connect Google Search Console in{" "}
        <Link
          to="/p/$projectId/settings/integrations"
          params={{ projectId }}
          className="underline"
        >
          Integrations
        </Link>{" "}
        to see which sitemap URLs are indexed.
      </p>
    );
  if (data.totalUrls === 0)
    return (
      <p className="text-sm text-muted-foreground">
        Run a sitemap check to load the URL list, then indexing is checked
        automatically (up to {data.dailyLimit.toLocaleString()} URLs a day).
      </p>
    );

  const stats = [
    { label: "Indexed", value: data.indexed, className: "text-success" },
    {
      label: "Not indexed",
      value: data.notIndexed,
      className: "text-destructive",
    },
    {
      label: "Not checked yet",
      value: data.notChecked,
      className: "text-muted-foreground",
    },
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-md border p-3">
            <div
              className={`text-2xl font-semibold tabular-nums ${stat.className}`}
            >
              {stat.value.toLocaleString()}
            </div>
            <div className="text-xs text-muted-foreground">{stat.label}</div>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Of {data.totalUrls.toLocaleString()} sitemap URLs · Search Console
        property {data.gscSiteUrl} · {data.usedToday.toLocaleString()}/
        {data.dailyLimit.toLocaleString()} checked today
        {data.failed ? ` · ${data.failed.toLocaleString()} checks failed` : ""}
        {data.lastRunAt
          ? ` · Last run ${new Date(data.lastRunAt).toLocaleString()}`
          : ""}
      </p>
      {data.lastError ? (
        <p role="alert" className="text-sm text-destructive">
          {data.lastError}
        </p>
      ) : null}
      {data.reasons.length ? (
        <div className="space-y-1 text-sm">
          <p className="font-medium">Why pages are not indexed</p>
          <ul className="space-y-1">
            {data.reasons.slice(0, 8).map((item) => (
              <li key={item.reason} className="flex justify-between gap-3">
                <span className="break-words">{item.reason}</span>
                <span className="tabular-nums">
                  {item.count.toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {showActions ? (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={check.isPending}
            onClick={() => check.mutate()}
          >
            {check.isPending ? "Checking…" : "Check indexing now"}
          </Button>
          <Button
            variant="outline"
            disabled={exportCsv.isPending}
            onClick={() => exportCsv.mutate()}
          >
            Export CSV
          </Button>
        </div>
      ) : null}
      {check.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {check.error.message}
        </p>
      ) : null}
      {check.isSuccess ? (
        <p role="status" className="text-sm">
          Checked {check.data.inspected} URLs.
        </p>
      ) : null}
    </div>
  );
}
