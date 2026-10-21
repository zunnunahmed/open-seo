import { Link } from "@tanstack/react-router";
import { CardShell } from "@/client/components/CardShell";
import { moreDetailsClass } from "@/client/features/dashboard/cardParts";
import { IndexCoverageSummary } from "@/client/features/projects/IndexCoverageSummary";

export function DashboardIndexCoverage({ projectId }: { projectId: string }) {
  return (
    <CardShell
      title="Google index coverage"
      action={
        <Link
          to="/p/$projectId/settings"
          params={{ projectId }}
          className={moreDetailsClass}
        >
          Details
        </Link>
      }
    >
      <IndexCoverageSummary projectId={projectId} />
    </CardShell>
  );
}
