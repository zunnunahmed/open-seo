import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { reverse } from "remeda";
import { CardShell } from "@/client/components/CardShell";
import { moreDetailsClass } from "@/client/features/dashboard/cardParts";
import { getSitemapMonitor } from "@/serverFunctions/sitemapMonitor";

type Snapshot = NonNullable<
  Awaited<ReturnType<typeof getSitemapMonitor>>
>["history"][number];

// Partial scans are hatched as well as muted, so "unverified" never relies
// on color alone.
const HATCH =
  "repeating-linear-gradient(135deg, rgb(255 255 255 / 0.5) 0 2px, transparent 2px 6px)";

const day = (s: Snapshot) =>
  new Date(s.scannedAt).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });

/** "22 Oct", plus the time when several scans share a day. */
function scanLabels(snapshots: Snapshot[]): string[] {
  const counts = new Map<string, number>();
  for (const s of snapshots) counts.set(day(s), (counts.get(day(s)) ?? 0) + 1);
  return snapshots.map((s) =>
    (counts.get(day(s)) ?? 0) > 1
      ? `${day(s)}, ${new Date(s.scannedAt).toLocaleTimeString(undefined, {
          hour: "numeric",
          minute: "2-digit",
        })}`
      : day(s),
  );
}

export function DashboardSitemapMonitor({ projectId }: { projectId: string }) {
  const { data, isPending, isError } = useQuery({
    queryKey: ["sitemapMonitor", projectId],
    queryFn: () => getSitemapMonitor({ data: { projectId } }),
  });
  const history = data?.history ?? [];
  const current = history[0];
  // Compare against the previous complete scan; a partial one is unverified.
  const previous = history.slice(1).find((s) => s.complete);
  const change =
    current?.complete && previous ? current.urlCount - previous.urlCount : null;
  const recent = reverse(history.slice(0, 6));
  const labels = scanLabels(recent);
  const max = Math.max(1, ...recent.map((s) => s.urlCount));

  return (
    <CardShell
      title="Sitemap pages"
      action={
        <Link
          to="/p/$projectId/settings"
          params={{ projectId }}
          className={moreDetailsClass}
        >
          Configure
        </Link>
      }
    >
      {isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : isError ? (
        <p className="text-sm text-destructive">
          Could not load the sitemap report.
        </p>
      ) : !data?.config ? (
        <p className="text-sm text-muted-foreground">
          Add your sitemap URL in Project settings to start tracking.
        </p>
      ) : !current ? (
        <p className="text-sm text-muted-foreground">
          No checks yet. Run the first one in Project settings.
        </p>
      ) : (
        <div className="space-y-4">
          <div>
            <p className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-3xl font-semibold tabular-nums">
                {current.urlCount.toLocaleString()}
              </span>
              <span className="text-sm text-muted-foreground">
                URLs in {current.sitemapCount.toLocaleString()}{" "}
                {current.sitemapCount === 1 ? "sitemap" : "sitemaps"}
              </span>
              {change !== null ? (
                <span className="text-sm font-medium tabular-nums">
                  {change === 0
                    ? "No change since last check"
                    : `${change > 0 ? "+" : ""}${change.toLocaleString()} since last check`}
                </span>
              ) : null}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Unique sitemap-listed URLs (not indexed pages) · checked{" "}
              {new Date(current.scannedAt).toLocaleDateString(undefined, {
                dateStyle: "medium",
              })}
            </p>
          </div>
          {recent.length > 1 ? (
            <ul className="space-y-1.5" aria-label="Recent sitemap checks">
              {recent.map((snapshot, index) => (
                <li
                  key={snapshot.scannedAt}
                  className="grid grid-cols-[6.5rem_1fr_3.5rem] items-center gap-2 text-xs"
                  title={`${labels[index]}: ${snapshot.urlCount.toLocaleString()} URLs${snapshot.complete ? "" : " (partial scan)"}`}
                >
                  <span className="truncate text-muted-foreground">
                    {labels[index]}
                  </span>
                  <div className="h-2 rounded bg-muted">
                    <div
                      className={`h-2 rounded ${snapshot.complete ? "bg-primary" : "bg-muted-foreground/40"}`}
                      style={{
                        width: `${Math.max(1.5, (100 * snapshot.urlCount) / max)}%`,
                        ...(snapshot.complete
                          ? {}
                          : { backgroundImage: HATCH }),
                      }}
                    />
                  </div>
                  <span className="text-right tabular-nums">
                    {snapshot.complete
                      ? snapshot.urlCount.toLocaleString()
                      : "partial"}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {!current.complete ? (
            <p role="status" className="flex gap-1.5 text-xs text-destructive">
              <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
              The latest check was partial, so a drop is not confirmed page
              removal.
            </p>
          ) : null}
        </div>
      )}
    </CardShell>
  );
}
