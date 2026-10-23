import { createFileRoute } from "@tanstack/react-router";
import { CompetitorTopicalMapPage } from "@/client/features/competitors/CompetitorTopicalMapPage";

export const Route = createFileRoute("/_app/p/$projectId/competitor-topical-map")({
  component: CompetitorTopicalMapRoute,
});

function CompetitorTopicalMapRoute() {
  const { projectId } = Route.useParams();
  return <CompetitorTopicalMapPage projectId={projectId} />;
}
