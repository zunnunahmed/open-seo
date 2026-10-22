import { createFileRoute } from "@tanstack/react-router";
import { SerpCheckerPage } from "@/client/features/keywords/serp-checker/SerpCheckerPage";

export const Route = createFileRoute("/_app/p/$projectId/serp-checker")({
  component: SerpCheckerPageRoute,
});

function SerpCheckerPageRoute() {
  const { projectId } = Route.useParams();
  return <SerpCheckerPage projectId={projectId} />;
}
