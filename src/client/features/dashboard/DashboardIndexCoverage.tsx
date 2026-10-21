import { Link } from "@tanstack/react-router";
import { IndexCoverageSummary } from "@/client/features/projects/IndexCoverageSummary";

export function DashboardIndexCoverage({ projectId }: { projectId: string }) {
  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold">Google index coverage</h2>
          <p className="text-xs text-muted-foreground">
            Sitemap URLs checked with Search Console URL Inspection
          </p>
        </div>
        <Link
          to="/p/$projectId/settings"
          params={{ projectId }}
          className="text-xs underline"
        >
          Details
        </Link>
      </div>
      <IndexCoverageSummary projectId={projectId} />
    </section>
  );
}
