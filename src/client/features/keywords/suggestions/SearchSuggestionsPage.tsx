import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/client/components/PageHeader";
import { Button } from "@/client/components/ui/button";
import { Card, CardContent } from "@/client/components/ui/card";
import { Checkbox } from "@/client/components/ui/checkbox";
import { Input } from "@/client/components/ui/input";
import { Label } from "@/client/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { Textarea } from "@/client/components/ui/textarea";
import { ErrorState } from "@/client/components/ErrorState";
import { EmptyState } from "@/client/components/EmptyState";
import {
  getErrorCode,
  getStandardErrorMessage,
} from "@/client/lib/error-messages";
import { GetCreditsButton } from "@/client/features/billing/InsufficientCreditsError";
import {
  getDataforseoSuggestions,
  getSearchSuggestions,
} from "@/serverFunctions/keywords";
import type { SuggestionModifierGroup } from "@/server/features/keywords/services/searchSuggestions";
import {
  COUNTRY_OPTIONS,
  ENDPOINT_LABELS,
  GROUP_OPTIONS,
  LIMIT_OPTIONS,
  type SuggestEndpoint,
  type SuggestionLimit,
} from "./suggestionOptions";
import { SuggestionsFreeResults } from "./SuggestionsFreeResults";
import { SuggestionsDfsResults } from "./SuggestionsDfsResults";

export function SearchSuggestionsPage({ projectId }: { projectId: string }) {
  const [mode, setMode] = useState<"free" | "dataforseo">("free");
  const [seedsText, setSeedsText] = useState("");
  const [gl, setGl] = useState("AU");
  const [hl, setHl] = useState("en");
  const [groups, setGroups] = useState<SuggestionModifierGroup[]>([
    "letters",
    "questions",
    "commercial",
  ]);
  const [limitPerSeed, setLimitPerSeed] = useState<SuggestionLimit>(200);

  const freeMutation = useMutation({
    mutationFn: (input: {
      seeds: string[];
      hl: string;
      gl: string;
      groups: SuggestionModifierGroup[];
    }) => getSearchSuggestions({ data: { ...input, projectId } }),
  });
  const dfsMutation = useMutation({
    mutationFn: (input: {
      seeds: string[];
      limitPerSeed: SuggestionLimit;
    }) =>
      getDataforseoSuggestions({
        data: { ...input, projectId },
      }),
  });

  const seeds = useMemo(
    () =>
      [...new Set(seedsText.split("\n").map((s) => s.trim()))]
        .filter(Boolean)
        .slice(0, 3),
    [seedsText],
  );
  const canMine =
    seeds.length > 0 &&
    (mode === "dataforseo" || groups.length > 0) &&
    !freeMutation.isPending &&
    !dfsMutation.isPending;
  const countryName =
    COUNTRY_OPTIONS.find((c) => c.code === gl)?.name ?? gl.toUpperCase();

  // ~$0.012 task + $0.00012 per returned row, billed on actual rows.
  const dfsCredits = Math.ceil((0.012 + limitPerSeed * 0.00012) * 1.28 * 1000);

  function toggleGroup(group: SuggestionModifierGroup, on: boolean) {
    setGroups((current) =>
      on ? [...current, group] : current.filter((g) => g !== group),
    );
  }

  function runMine() {
    if (mode === "free") {
      freeMutation.mutate({ seeds, hl, gl, groups });
    } else {
      dfsMutation.mutate({ seeds, limitPerSeed });
    }
  }

  const dfsOutOfCredits =
    getErrorCode(dfsMutation.error) === "INSUFFICIENT_CREDITS";

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Search Suggestions"
        description="Mine autocomplete before and after your seed for free — or pull Google-based suggestions with volume via DataForSEO."
      />
      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={mode === "free" ? "default" : "outline"}
              size="sm"
              onClick={() => setMode("free")}
            >
              Free autocomplete
            </Button>
            <Button
              variant={mode === "dataforseo" ? "default" : "outline"}
              size="sm"
              onClick={() => setMode("dataforseo")}
            >
              DataForSEO + volume
            </Button>
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_220px_160px]">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="suggestion-seeds">
                Seed keywords (one per line, up to 3)
              </Label>
              <Textarea
                id="suggestion-seeds"
                value={seedsText}
                onChange={(event) => setSeedsText(event.target.value)}
                placeholder={"ai automation agency\ncrm automation"}
                rows={3}
              />
            </div>
            {mode === "free" ? (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="suggestion-country">Country</Label>
                  <Select
                    items={COUNTRY_OPTIONS.map((country) => ({
                      value: country.code,
                      label: country.name,
                    }))}
                    value={gl}
                    onValueChange={(next) => {
                      if (next !== null) setGl(next);
                    }}
                  >
                    <SelectTrigger id="suggestion-country" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {COUNTRY_OPTIONS.map((country) => (
                        <SelectItem key={country.code} value={country.code}>
                          {country.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="suggestion-hl">Language (HL)</Label>
                  <Input
                    id="suggestion-hl"
                    value={hl}
                    maxLength={5}
                    onChange={(event) => setHl(event.target.value)}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="suggestion-limit">Results per seed</Label>
                  <Select
                    items={LIMIT_OPTIONS.map((limit) => ({
                      value: String(limit),
                      label: String(limit),
                    }))}
                    value={String(limitPerSeed)}
                    onValueChange={(next) => {
                      if (next !== null)
                        setLimitPerSeed(Number(next) as SuggestionLimit);
                    }}
                  >
                    <SelectTrigger id="suggestion-limit" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LIMIT_OPTIONS.map((limit) => (
                        <SelectItem key={limit} value={String(limit)}>
                          {limit}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Market</Label>
                  <p className="text-sm text-muted-foreground">
                    Your project market · ≈{dfsCredits} credits per seed
                  </p>
                </div>
              </>
            )}
          </div>
          {mode === "free" ? (
            <div className="flex flex-wrap items-center gap-4">
              {GROUP_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className="flex cursor-pointer items-center gap-2 text-sm"
                >
                  <Checkbox
                    checked={groups.includes(option.value)}
                    onCheckedChange={(checked) =>
                      toggleGroup(option.value, checked === true)
                    }
                  />
                  <span className="font-medium">{option.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {option.hint}
                  </span>
                </label>
              ))}
            </div>
          ) : null}
          <div>
            <Button
              disabled={!canMine}
              pending={freeMutation.isPending || dfsMutation.isPending}
              onClick={runMine}
            >
              {mode === "free" ? "Mine suggestions" : "Get suggestions"}
            </Button>
          </div>
          {freeMutation.isError ? (
            <ErrorState
              title="Suggestions failed"
              message={getStandardErrorMessage(freeMutation.error)}
              onRetry={runMine}
              isRetrying={freeMutation.isPending}
            />
          ) : null}
          {dfsMutation.isError ? (
            <ErrorState
              title="DataForSEO suggestions failed"
              message={getStandardErrorMessage(dfsMutation.error)}
              onRetry={runMine}
              isRetrying={dfsMutation.isPending}
              action={dfsOutOfCredits ? <GetCreditsButton /> : undefined}
            />
          ) : null}
        </CardContent>
      </Card>

      {mode === "free" ? (
        freeMutation.data ? (
          freeMutation.data.endpoint === null ? (
            <ErrorState
              variant="card"
              title="Google blocked this run"
              message={`No Google suggest host answered (${freeMutation.data.probeLog.map((p) => `${ENDPOINT_LABELS[p.endpoint as SuggestEndpoint]}: ${p.result}`).join(" · ")}). Wait a few minutes and try again — mining more slowly helps, and the tool now spaces its requests out.`}
              onRetry={runMine}
              isRetrying={freeMutation.isPending}
            />
          ) : (
            <SuggestionsFreeResults
              rows={freeMutation.data.rows}
              queriesRun={freeMutation.data.queriesRun}
              countryName={countryName}
            />
          )
        ) : (
          !freeMutation.isPending && (
            <EmptyState
              variant="plain"
              title="Enter a seed to mine suggestions"
              description="Each modifier runs twice — once before and once after your seed — against live autocomplete."
            />
          )
        )
      ) : dfsMutation.data ? (
        <SuggestionsDfsResults rows={dfsMutation.data.rows} />
      ) : (
        !dfsMutation.isPending && (
          <EmptyState
            variant="plain"
            title="Enter a seed to get DataForSEO suggestions"
            description="Google-based suggestions with volume, CPC, competition, difficulty and intent for your project market."
          />
        )
      )}
    </div>
  );
}
