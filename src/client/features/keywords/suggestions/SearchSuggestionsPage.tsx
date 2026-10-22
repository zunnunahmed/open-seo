import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import { PageHeader } from "@/client/components/PageHeader";
import { Badge } from "@/client/components/ui/badge";
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
import { DataTable, useDataTable } from "@/client/components/table/DataTable";
import { SortableHeader } from "@/client/components/table/SortableHeader";
import { ExportMenu } from "@/client/components/ExportMenu";
import { ErrorState } from "@/client/components/ErrorState";
import { EmptyState } from "@/client/components/EmptyState";
import { exportRows } from "@/client/lib/exportRows";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { getSearchSuggestions } from "@/serverFunctions/keywords";
import type { SuggestionModifierGroup } from "@/server/features/keywords/services/searchSuggestions";

type SuggestionRow = {
  keyword: string;
  placement: "before" | "after";
  modifier: string;
  seed: string;
  query: string;
};

type SuggestSource = "google" | "duckduckgo" | "yahoo";

const SOURCE_LABELS: Record<SuggestSource, string> = {
  google: "Google",
  duckduckgo: "DuckDuckGo",
  yahoo: "Yahoo",
};

const COUNTRY_OPTIONS: Array<{ code: string; name: string }> = [
  { code: "AU", name: "Australia" },
  { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" },
  { code: "CA", name: "Canada" },
  { code: "NZ", name: "New Zealand" },
  { code: "IE", name: "Ireland" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
  { code: "NL", name: "Netherlands" },
  { code: "ES", name: "Spain" },
  { code: "IT", name: "Italy" },
  { code: "PT", name: "Portugal" },
  { code: "CH", name: "Switzerland" },
  { code: "AT", name: "Austria" },
  { code: "BE", name: "Belgium" },
  { code: "SE", name: "Sweden" },
  { code: "NO", name: "Norway" },
  { code: "DK", name: "Denmark" },
  { code: "FI", name: "Finland" },
  { code: "PL", name: "Poland" },
  { code: "GR", name: "Greece" },
  { code: "IN", name: "India" },
  { code: "PK", name: "Pakistan" },
  { code: "BD", name: "Bangladesh" },
  { code: "SG", name: "Singapore" },
  { code: "MY", name: "Malaysia" },
  { code: "PH", name: "Philippines" },
  { code: "ID", name: "Indonesia" },
  { code: "TH", name: "Thailand" },
  { code: "VN", name: "Vietnam" },
  { code: "JP", name: "Japan" },
  { code: "KR", name: "South Korea" },
  { code: "HK", name: "Hong Kong" },
  { code: "TW", name: "Taiwan" },
  { code: "AE", name: "United Arab Emirates" },
  { code: "SA", name: "Saudi Arabia" },
  { code: "IL", name: "Israel" },
  { code: "TR", name: "Türkiye" },
  { code: "ZA", name: "South Africa" },
  { code: "NG", name: "Nigeria" },
  { code: "KE", name: "Kenya" },
  { code: "EG", name: "Egypt" },
  { code: "BR", name: "Brazil" },
  { code: "MX", name: "Mexico" },
];

const GROUP_OPTIONS: Array<{
  value: SuggestionModifierGroup;
  label: string;
  hint: string;
}> = [
  { value: "letters", label: "Letters a–z", hint: "52 queries per seed" },
  {
    value: "questions",
    label: "Questions",
    hint: "who, what, where… (24 per seed)",
  },
  {
    value: "commercial",
    label: "Commercial",
    hint: "best, price, near me… (22 per seed)",
  },
];

const suggestionColumnHelper = createColumnHelper<SuggestionRow>();

function buildColumns() {
  return [
    suggestionColumnHelper.accessor("keyword", {
      header: ({ column }) => (
        <SortableHeader column={column} label="Keyword" />
      ),
      cell: ({ getValue }) => (
        <span className="block max-w-[420px] truncate" title={getValue()}>
          {getValue()}
        </span>
      ),
      meta: { cellClassName: "max-w-[420px]" },
    }),
    suggestionColumnHelper.accessor("placement", {
      header: ({ column }) => (
        <SortableHeader column={column} label="Position" />
      ),
      cell: ({ getValue }) =>
        getValue() === "before" ? (
          <Badge variant="soft" size="sm" title="Modifier added before the seed">
            Before
          </Badge>
        ) : (
          <Badge
            variant="secondary"
            size="sm"
            title="Modifier added after the seed"
          >
            After
          </Badge>
        ),
      meta: { cellClassName: "whitespace-nowrap" },
    }),
    suggestionColumnHelper.accessor("modifier", {
      header: ({ column }) => (
        <SortableHeader column={column} label="Modifier" />
      ),
      meta: { cellClassName: "whitespace-nowrap" },
    }),
    suggestionColumnHelper.accessor("seed", {
      header: ({ column }) => <SortableHeader column={column} label="Seed" />,
      meta: { cellClassName: "whitespace-nowrap" },
    }),
  ];
}

const SUGGESTION_HEADERS = ["Keyword", "Position", "Modifier", "Seed query"];

export function SearchSuggestionsPage({ projectId }: { projectId: string }) {
  const [seedsText, setSeedsText] = useState("");
  const [gl, setGl] = useState("AU");
  const [hl, setHl] = useState("en");
  const [groups, setGroups] = useState<SuggestionModifierGroup[]>([
    "letters",
    "questions",
    "commercial",
  ]);

  const mutation = useMutation({
    mutationFn: (input: {
      seeds: string[];
      hl: string;
      gl: string;
      groups: SuggestionModifierGroup[];
    }) => getSearchSuggestions({ data: { ...input, projectId } }),
  });

  const seeds = useMemo(
    () =>
      [...new Set(seedsText.split("\n").map((s) => s.trim()))]
        .filter(Boolean)
        .slice(0, 3),
    [seedsText],
  );
  const canMine = seeds.length > 0 && groups.length > 0 && !mutation.isPending;
  const countryName =
    COUNTRY_OPTIONS.find((c) => c.code === gl)?.name ?? gl.toUpperCase();

  const rows: SuggestionRow[] = mutation.data?.rows ?? [];
  const source = mutation.data?.source ?? null;
  const columns = useMemo(buildColumns, []);
  const table = useDataTable({
    data: rows,
    columns,
    withSorting: true,
  });

  function toggleGroup(group: SuggestionModifierGroup, on: boolean) {
    setGroups((current) =>
      on ? [...current, group] : current.filter((g) => g !== group),
    );
  }

  function runMine() {
    mutation.mutate({ seeds, hl, gl, groups });
  }

  function onExport(format: "csv" | "json" | "sheets") {
    void exportRows({
      format,
      feature: "search_suggestions",
      headers: SUGGESTION_HEADERS,
      rows: rows.map((row) => [
        row.keyword,
        row.placement,
        row.modifier,
        row.query,
      ]),
      filename: "search-suggestions",
      records: rows,
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Search Suggestions"
        description="Mine autocomplete: every modifier crossed before and after your seed. Free — no credits used."
      />
      <Card>
        <CardContent className="flex flex-col gap-4">
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
            <Button disabled={!canMine} pending={mutation.isPending} onClick={runMine}>
              Mine suggestions
            </Button>
          </div>
          {mutation.isError ? (
            <ErrorState
              title="Suggestions failed"
              message={getStandardErrorMessage(mutation.error)}
              onRetry={runMine}
              isRetrying={mutation.isPending}
            />
          ) : null}
        </CardContent>
      </Card>

      {mutation.data ? (
        mutation.data.source === null ? (
          <ErrorState
            variant="card"
            title="Suggestions are unreachable right now"
            message={`Google, DuckDuckGo and Yahoo all returned nothing (${mutation.data.probeLog.map((p) => `${SOURCE_LABELS[p.source as SuggestSource]}: ${p.result}`).join(" · ")}). This usually means the server IP is temporarily rate-limited. Wait a few minutes and try again.`}
            onRetry={runMine}
            isRetrying={mutation.isPending}
          />
        ) : (
          <DataTable
            table={table}
            empty={{
              title: "No suggestions found",
              description: `${SOURCE_LABELS[source as SuggestSource]} returned nothing for these expansions in ${countryName}. Try a broader seed.`,
            }}
            toolbar={
              <div className="flex w-full items-center justify-between gap-2">
                <span className="text-sm tabular-nums text-muted-foreground">
                  {rows.length.toLocaleString("en-US")} keywords from{" "}
                  {mutation.data.queriesRun.toLocaleString("en-US")} queries ·{" "}
                  Source: {SOURCE_LABELS[source as SuggestSource]}
                  {source !== "google"
                    ? " (Google blocked this run)"
                    : null}
                </span>
                {rows.length > 0 ? (
                  <ExportMenu
                    actions={["sheets", "csv", "json"]}
                    onExport={onExport}
                  />
                ) : null}
              </div>
            }
          />
        )
      ) : (
        !mutation.isPending && (
          <EmptyState
            variant="plain"
            title="Enter a seed to mine suggestions"
            description="Each modifier runs twice — once before and once after your seed — against live autocomplete."
          />
        )
      )}
    </div>
  );
}
