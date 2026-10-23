import { createFileRoute } from "@tanstack/react-router";
import { OutreachPage } from "@/client/features/outreach/OutreachPage";

export const Route = createFileRoute("/_app/p/$projectId/outreach")({
  component: OutreachRoute,
});

function OutreachRoute() {
  const { projectId } = Route.useParams();
  return <OutreachPage projectId={projectId} />;
}
