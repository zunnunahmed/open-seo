import { useState } from "react";
import { PageHeader } from "@/client/components/PageHeader";
import { Button } from "@/client/components/ui/button";
import { Card, CardContent } from "@/client/components/ui/card";
import { Input } from "@/client/components/ui/input";
import { Label } from "@/client/components/ui/label";
import { EmptyState } from "@/client/components/EmptyState";
import { useProjectMarket } from "@/client/features/projects/useProjectMarket";
import { useKeywordSerpAnalysis } from "@/client/features/keywords/hooks/useKeywordSerpAnalysis";
import { KeywordAreaField } from "@/client/features/keywords/page/KeywordAreaField";
import { SerpAnalysisCard } from "@/client/features/keywords/components/SerpAnalysisCard";

/**
 * Standalone localized SERP checker: any query, project market by default
 * with an optional city/county/region narrowing. Each check spends
 * DataForSEO SERP credits (depth 20 first, 100 on demand).
 */
export function SerpCheckerPage({ projectId }: { projectId: string }) {
  const market = useProjectMarket(projectId);
  const [keywordInput, setKeywordInput] = useState("");
  const [locationName, setLocationName] = useState<string | undefined>(
    undefined,
  );

  const serp = useKeywordSerpAnalysis(
    projectId,
    market?.locationCode,
    locationName,
  );

  function check() {
    const keyword = keywordInput.trim();
    if (keyword) serp.setSerpKeyword(keyword);
  }

  function onKeywordChange(value: string) {
    setKeywordInput(value);
    // Don't show a previous keyword's SERP while typing a new one.
    if (serp.serpKeyword !== null && value.trim() !== serp.serpKeyword) {
      serp.setSerpKeyword(null);
    }
  }

  const hasChecked = serp.serpKeyword !== null || serp.serpResults.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="SERP Checker"
        description="See Google's live results for any query — project market by default, or narrow to an area. Top 20 costs about 5 credits; paging to the full 100 costs about 20 more."
      />
      <Card>
        <CardContent>
          <form
            className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_280px_auto] lg:items-end"
            onSubmit={(event) => {
              event.preventDefault();
              check();
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="serp-checker-keyword">Query</Label>
              <Input
                id="serp-checker-keyword"
                value={keywordInput}
                onChange={(event) => onKeywordChange(event.target.value)}
                placeholder="best crm for small business"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="serp-checker-area">
                Area <span className="font-normal">(optional)</span>
              </Label>
              {market?.locationCode === undefined ? (
                <Input
                  id="serp-checker-area"
                  disabled
                  placeholder="Loading market…"
                />
              ) : (
                <KeywordAreaField
                  locationCode={market.locationCode}
                  value={locationName}
                  onChange={setLocationName}
                />
              )}
            </div>
            <Button
              type="submit"
              disabled={!keywordInput.trim() || serp.serpLoading}
              pending={serp.serpLoading}
            >
              Check SERP
            </Button>
          </form>
        </CardContent>
      </Card>

      {!hasChecked && !serp.serpLoading ? (
        <EmptyState
          variant="plain"
          title="Enter a query to check its SERP"
          description="Top 20 organic results first; page further for the top 100."
        />
      ) : (
        <SerpAnalysisCard
          items={serp.serpResults}
          keyword={serp.activeSerpKeyword}
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
      )}
    </div>
  );
}
