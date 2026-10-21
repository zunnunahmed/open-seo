import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { KeywordClusteringPage } from "@/client/features/keyword-clustering/KeywordClusteringPage";

export const Route = createFileRoute("/_app/p/$projectId/keyword-clustering")({
  validateSearch: z.object({ job: z.string().uuid().optional() }),
  remountDeps: ({ params }) => params.projectId,
  component: KeywordClusteringRoute,
});

function KeywordClusteringRoute() {
  const { projectId } = Route.useParams();
  const { job } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <KeywordClusteringPage
      projectId={projectId}
      jobId={job}
      onSelectJob={(next) => void navigate({ search: { job: next } })}
    />
  );
}
