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
  MODIFIER_COUNTS,
  type SuggestEndpoint,
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
      groups: SuggestionModifierGroup[];
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
    groups.length > 0 &&
    !freeMutation.isPending &&
    !dfsMutation.isPending;
  const countryName =
    COUNTRY_OPTIONS.find((c) => c.code === gl)?.name ?? gl.toUpperCase();

  // Upper-bound estimate: every expansion billed as one autocomplete call,
  // plus one overview task per seed sized to the expansion count.
  const expansionsPerSeed =
    groups.reduce((sum, group) => sum + MODIFIER_COUNTS[group], 0) * 2;
  const expansions = Math.min(300, expansionsPerSeed * seeds.length);
  const dfsCostUsd = expansions * 0.002 + 0.012 + expansions * 0.00012;
  const dfsCostCredits = Math.ceil(dfsCostUsd * 1.28 * 1000);

  function toggleGroup(group: SuggestionModifierGroup, on: boolean) {
    setGroups((current) =>
      on ? [...current, group] : current.filter((g) => g !== group),
    );
  }

  function runMine() {
    if (mode === "free") {
      freeMutation.mutate({ seeds, hl, gl, groups });
    } else {
      dfsMutation.mutate({ seeds, groups });
    }
  }

  const dfsOutOfCredits =
    getErrorCode(dfsMutation.error) === "INSUFFICIENT_CREDITS";

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Search Suggestions"
        description="Mine autocomplete before and after your seed for free — or pay per lookup for Google suggestions with volume via DataForSEO."
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
              <div className="flex flex-col gap-1.5 lg:col-span-2">
                <Label>Cost estimate</Label>
                <p className="text-sm text-muted-foreground">
                  ≈ ${dfsCostUsd.toFixed(2)} (≈{dfsCostCredits} credits) per
                  run at current seed/modifier selection. Uses your project
                  market. Served from cache when repeated within 24 hours.
                </p>
              </div>
            )}
          </div>
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
              message={`No Google suggest host answered (${freeMutation.data.probeLog.map((p) => `${ENDPOINT_LABELS[p.endpoint as SuggestEndpoint]}: ${p.result}`).join(" · ")}). Wait a few minutes and try again, or switch to the DataForSEO source above — same before/after modifiers, billed per lookup.`}
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
            description="Google autocomplete expansions crossed before and after your seed, each enriched with volume, CPC, competition, difficulty and intent."
          />
        )
      )}
    </div>
  );
}
