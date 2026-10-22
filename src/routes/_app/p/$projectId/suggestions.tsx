import { createFileRoute } from "@tanstack/react-router";
import { SearchSuggestionsPage } from "@/client/features/keywords/suggestions/SearchSuggestionsPage";

export const Route = createFileRoute("/_app/p/$projectId/suggestions")({
  component: SearchSuggestionsPageRoute,
});

function SearchSuggestionsPageRoute() {
  const { projectId } = Route.useParams();
  return <SearchSuggestionsPage projectId={projectId} />;
}
