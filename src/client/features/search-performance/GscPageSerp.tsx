import { Search } from "lucide-react";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { SerpAnalysisCard } from "@/client/features/keywords/components/SerpAnalysisCard";
import type { useKeywordSerpAnalysis } from "@/client/features/keywords/hooks/useKeywordSerpAnalysis";
import type { SerpResultItem } from "@/types/keywords";

type Serp = ReturnType<typeof useKeywordSerpAnalysis>;

/** A URL without scheme, www, query or trailing slash, for comparing. */
const bareUrl = (url: string) =>
  url
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");

/** Where this page sits in the checked SERP, and who is above it. */
function PagePosition({
  page,
  items,
}: {
  page: string;
  items: SerpResultItem[];
}) {
  const own = items.find((item) => bareUrl(item.url) === bareUrl(page));
  const above = own ? items.filter((item) => item.rank < own.rank) : items;
  return (
    <div className="rounded-lg border bg-muted/30 p-3 text-sm">
      {own ? (
        <p>
          This page ranks <strong>#{own.rank}</strong> in the live results.
        </p>
      ) : (
        <p>
          This page is <strong>not in the top {items.length}</strong> live
          results.
        </p>
      )}
      {above.length ? (
        <p className="mt-1 text-xs text-muted-foreground">
          Above it:{" "}
          {above
            .slice(0, 5)
            .map((item) => item.domain)
            .join(", ")}
          {above.length > 5 ? ` and ${above.length - 5} more` : ""}
        </p>
      ) : null}
    </div>
  );
}

/** Check today's Google results for one of the page's queries (paid). */
export function GscPageSerp({
  page,
  selected,
  onSelect,
  serp,
}: {
  page: string;
  selected: string;
  onSelect: (query: string) => void;
  serp: Serp;
}) {
  const checked = serp.activeSerpKeyword;
  return (
    <div className="space-y-3">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const query = selected.trim();
          if (query) serp.setSerpKeyword(query);
        }}
      >
        <Input
          className="h-9 min-w-0 max-w-md flex-1"
          aria-label="Query to check"
          placeholder="Paste or type a query"
          value={selected}
          onChange={(event) => onSelect(event.target.value)}
        />
        <Button type="submit" disabled={!selected.trim() || serp.serpLoading}>
          <Search className="size-4" />
          Check live SERP (paid)
        </Button>
      </form>
      {checked && !serp.serpLoading && serp.serpResults.length ? (
        <PagePosition page={page} items={serp.serpResults} />
      ) : null}
      {checked ? (
        <SerpAnalysisCard
          items={serp.serpResults}
          keyword={checked}
          loading={serp.serpLoading}
          loadingMore={serp.serpLoadingMore}
          canLoadMore={serp.canLoadMoreSerp}
          error={serp.serpError}
          outOfCredits={serp.serpOutOfCredits}
          onRetry={serp.retrySerp}
          retrying={serp.serpLoading}
          deepFetchFailed={serp.deepFetchFailed}
          page={serp.serpPage}
          pageSize={serp.SERP_PAGE_SIZE}
          onPageChange={serp.setSerpPage}
        />
      ) : (
        <p className="text-xs text-muted-foreground">
          One paid Google search through your project’s data source, in the
          project’s country. Tip: click any query in the table below to check it
          here.
        </p>
      )}
    </div>
  );
}
