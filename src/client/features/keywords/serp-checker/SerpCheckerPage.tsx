import { useState } from "react";
import { Search } from "lucide-react";
import { PageHeader } from "@/client/components/PageHeader";
import { Button } from "@/client/components/ui/button";
import { Card, CardContent } from "@/client/components/ui/card";
import { Input } from "@/client/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/client/components/ui/input-group";
import { EmptyState } from "@/client/components/EmptyState";
import { LocationSelect } from "@/client/components/LocationSelect";
import { useProjectMarket } from "@/client/features/projects/useProjectMarket";
import { useKeywordSerpAnalysis } from "@/client/features/keywords/hooks/useKeywordSerpAnalysis";
import { KeywordAreaField } from "@/client/features/keywords/page/KeywordAreaField";
import { SerpAnalysisCard } from "@/client/features/keywords/components/SerpAnalysisCard";
import { DataSourceLabel } from "@/client/features/integrations/DataSourceLabel";

/**
 * Standalone localized SERP checker: any query and country (the project
 * market by default) with an optional city/county/region narrowing. Each check spends
 * DataForSEO SERP credits (depth 20 first, 100 on demand).
 */
export function SerpCheckerPage({ projectId }: { projectId: string }) {
  const market = useProjectMarket(projectId);
  // Until the user picks a country, follow the project market.
  const [pickedLocationCode, setPickedLocationCode] = useState<number>();
  const locationCode = pickedLocationCode ?? market?.locationCode;
  const [keywordInput, setKeywordInput] = useState("");
  const [locationName, setLocationName] = useState<string | undefined>(
    undefined,
  );

  const serp = useKeywordSerpAnalysis(projectId, locationCode, locationName);

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
    <div className="h-full overflow-auto px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
        <PageHeader
          title="SERP Checker"
          actions={<DataSourceLabel projectId={projectId} />}
          description="See Google's live results for any query in any country — project market by default, or narrow to a city or region. Top 20 costs about 5 credits; paging to the full 100 costs about 20 more."
        />
        <Card className="overflow-visible">
          <CardContent>
          {/* Same row as Keyword Research: query, country, city, action. */}
          <form
            className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-start"
            onSubmit={(event) => {
              event.preventDefault();
              check();
            }}
          >
            <InputGroup className="h-10 w-full lg:min-w-0 lg:flex-1">
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput
                value={keywordInput}
                onChange={(event) => onKeywordChange(event.target.value)}
                placeholder="Enter a query"
                aria-label="Query"
              />
            </InputGroup>
            <div className="grid grid-cols-2 gap-2 lg:contents">
              {locationCode === undefined ? (
                <Input
                  disabled
                  placeholder="Loading market…"
                  aria-label="Country"
                  className="col-span-2 w-full lg:w-44 lg:shrink-0"
                />
              ) : (
                <>
                  <LocationSelect
                    value={locationCode}
                    onChange={(code) => {
                      setPickedLocationCode(code);
                      // An area belongs to one country.
                      setLocationName(undefined);
                    }}
                    className="col-span-2 w-full lg:w-44 lg:shrink-0"
                  />
                  <KeywordAreaField
                    locationCode={locationCode}
                    value={locationName}
                    onChange={setLocationName}
                  />
                </>
              )}
              <Button
                type="submit"
                className="w-full px-6 lg:w-auto lg:shrink-0"
                disabled={!keywordInput.trim() || serp.serpLoading}
                pending={serp.serpLoading}
              >
                Check SERP
              </Button>
            </div>
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
    </div>
  );
}
