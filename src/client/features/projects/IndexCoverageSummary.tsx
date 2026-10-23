import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  RefreshCw,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/client/components/ui/button";
import { buildCsv } from "@/client/lib/csv";
import { downloadFile } from "@/client/lib/download";
import {
  checkIndexCoverageNow,
  getIndexCoverage,
  listIndexCoverageRows,
} from "@/serverFunctions/indexCoverage";

// Red and green are indistinguishable for deutan readers, so "not indexed"
// also carries a hatch texture, and every state an icon and a text label.
const HATCH =
  "repeating-linear-gradient(135deg, rgb(255 255 255 / 0.45) 0 2px, transparent 2px 6px)";

type Segment = {
  key: string;
  label: string;
  value: number;
  icon: LucideIcon;
  iconClass: string;
  barClass: string;
  hatched?: boolean;
};

const percent = (value: number, total: number) =>
  total ? Math.round((value / total) * 100) : 0;

function CoverageMeter({
  segments,
  total,
}: {
  segments: Segment[];
  total: number;
}) {
  const visible = segments.filter((s) => s.value > 0);
  return (
    <div className="space-y-3">
      <div
        className="flex h-3 w-full gap-0.5 overflow-hidden rounded"
        role="img"
        aria-label={segments
          .map((s) => `${s.label}: ${s.value} of ${total}`)
          .join(", ")}
      >
        {visible.map((segment) => (
          <div
            key={segment.key}
            className={`h-full first:rounded-l last:rounded-r ${segment.barClass}`}
            style={{
              width: `${(segment.value / total) * 100}%`,
              minWidth: 4,
              ...(segment.hatched ? { backgroundImage: HATCH } : {}),
            }}
            title={`${segment.label}: ${segment.value.toLocaleString()} (${percent(segment.value, total)}%)`}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
        {segments.map((segment) => {
          const Icon = segment.icon;
          return (
            <li key={segment.key} className="flex items-center gap-1.5">
              <Icon className={`size-4 ${segment.iconClass}`} aria-hidden />
              <span className="text-muted-foreground">{segment.label}</span>
              <span className="font-medium tabular-nums">
                {segment.value.toLocaleString()}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {percent(segment.value, total)}%
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ReasonList({
  reasons,
  total,
  limit,
}: {
  reasons: Array<{ reason: string; count: number }>;
  total: number;
  limit: number;
}) {
  const max = Math.max(1, ...reasons.map((r) => r.count));
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">
        Why pages are not indexed
      </p>
      <ul className="space-y-2">
        {reasons.slice(0, limit).map((item) => (
          <li
            key={item.reason}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-sm"
            title={`${item.reason}: ${item.count} of ${total} not indexed`}
          >
            <span className="truncate">{item.reason}</span>
            <span className="tabular-nums">{item.count.toLocaleString()}</span>
            <div className="col-span-2 h-1.5 rounded bg-muted">
              <div
                className="h-1.5 rounded bg-foreground/35"
                style={{ width: `${(item.count / max) * 100}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
      {reasons.length > limit ? (
        <p className="text-xs text-muted-foreground">
          +{reasons.length - limit} more reasons in the CSV export
        </p>
      ) : null}
    </div>
  );
}

/** Google index coverage of sitemap URLs (Search Console URL Inspection). */
export function IndexCoverageSummary({
  projectId,
  variant = "compact",
}: {
  projectId: string;
  variant?: "compact" | "full";
}) {
  const full = variant === "full";
  const client = useQueryClient();
  const queryKey = ["indexCoverage", projectId];
  const query = useQuery({
    queryKey,
    queryFn: () => getIndexCoverage({ data: { projectId } }),
  });
  // One click checks every due URL: each batch is its own request (within
  // the Workers subrequest cap) until nothing is due, the daily limit is
  // reached, or the user stops.
  const stopRequested = useRef(false);
  const [checkedSoFar, setCheckedSoFar] = useState(0);
  const check = useMutation({
    mutationFn: async () => {
      stopRequested.current = false;
      setCheckedSoFar(0);
      let inspected = 0;
      while (!stopRequested.current) {
        const result = await checkIndexCoverageNow({ data: { projectId } });
        if (!result.ok) throw new Error(result.error);
        if (result.inspected === 0) break;
        inspected += result.inspected;
        setCheckedSoFar(inspected);
        void client.invalidateQueries({ queryKey });
      }
      if (inspected === 0)
        throw new Error(
          "Nothing to check: run a sitemap check first, or today's limit is reached, or all URLs were checked in the last 7 days.",
        );
      return { inspected, stopped: stopRequested.current };
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
        Run a sitemap check to load the URL list. Indexing is then checked
        automatically, up to {data.dailyLimit.toLocaleString()} URLs a day.
      </p>
    );

  const notChecked = data.notChecked + data.failed;
  const segments: Segment[] = [
    {
      key: "indexed",
      label: "Indexed",
      value: data.indexed,
      icon: CheckCircle2,
      iconClass: "text-success",
      barClass: "bg-success",
    },
    {
      key: "not-indexed",
      label: "Not indexed",
      value: data.notIndexed,
      icon: XCircle,
      iconClass: "text-destructive",
      barClass: "bg-destructive",
      hatched: true,
    },
    {
      key: "not-checked",
      label: data.failed ? "Not checked / failed" : "Not checked yet",
      value: notChecked,
      icon: Clock,
      iconClass: "text-muted-foreground",
      barClass: "bg-muted-foreground/25",
    },
  ];

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <p className="flex items-baseline gap-2">
          <span className="text-3xl font-semibold tabular-nums">
            {data.indexed.toLocaleString()}
          </span>
          <span className="text-sm text-muted-foreground">
            of {data.totalUrls.toLocaleString()} sitemap URLs indexed (
            {percent(data.indexed, data.totalUrls)}%)
          </span>
        </p>
        <CoverageMeter segments={segments} total={data.totalUrls} />
      </div>

      {data.lastError ? (
        <div
          role="alert"
          className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
        >
          <AlertTriangle
            className="mt-0.5 size-4 shrink-0 text-destructive"
            aria-hidden
          />
          <span>{data.lastError}</span>
        </div>
      ) : null}

      {data.reasons.length ? (
        <div className={full ? "max-w-2xl" : undefined}>
          <ReasonList
            reasons={data.reasons}
            total={data.notIndexed}
            limit={full ? 8 : 3}
          />
        </div>
      ) : null}

      <dl className="grid gap-x-6 gap-y-1 text-xs text-muted-foreground sm:grid-cols-[auto_1fr]">
        {full ? (
          <>
            <dt>Search Console property</dt>
            <dd className="break-all text-foreground">{data.gscSiteUrl}</dd>
          </>
        ) : null}
        <dt>Checked today</dt>
        <dd className="text-foreground tabular-nums">
          {data.usedToday.toLocaleString()} of{" "}
          {data.dailyLimit.toLocaleString()} daily limit
        </dd>
        {data.lastRunAt ? (
          <>
            <dt>Last run</dt>
            <dd className="text-foreground">
              {new Date(data.lastRunAt).toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </dd>
          </>
        ) : null}
      </dl>

      {full ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            disabled={check.isPending}
            onClick={() => check.mutate()}
          >
            <RefreshCw
              className={`size-4 ${check.isPending ? "animate-spin" : ""}`}
            />
            {check.isPending
              ? `Checking… ${checkedSoFar.toLocaleString()} checked`
              : "Check indexing now"}
          </Button>
          {check.isPending ? (
            <Button
              variant="ghost"
              onClick={() => {
                stopRequested.current = true;
              }}
            >
              Stop after this batch
            </Button>
          ) : null}
          <Button
            variant="outline"
            disabled={exportCsv.isPending}
            onClick={() => exportCsv.mutate()}
          >
            <Download className="size-4" />
            Export CSV
          </Button>
          {check.isError ? (
            <p role="alert" className="text-sm text-destructive">
              {check.error.message}
            </p>
          ) : null}
          {check.isSuccess ? (
            <p role="status" className="text-sm text-muted-foreground">
              {check.data.stopped ? "Stopped after checking" : "Checked"}{" "}
              {check.data.inspected.toLocaleString()} URLs.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
