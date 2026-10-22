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

  const rows: SuggestionRow[] = mutation.data?.rows ?? [];
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
        description="Mine Google autocomplete: every modifier crossed before and after your seed. Free — no credits used."
      />
      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_160px_160px]">
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
              <Label htmlFor="suggestion-gl">Country (GL)</Label>
              <Input
                id="suggestion-gl"
                value={gl}
                maxLength={2}
                onChange={(event) => setGl(event.target.value)}
              />
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
            <Button
              disabled={!canMine}
              pending={mutation.isPending}
              onClick={() =>
                mutation.mutate({ seeds, hl, gl, groups })
              }
            >
              Mine suggestions
            </Button>
          </div>
          {mutation.isError ? (
            <ErrorState
              title="Suggestions failed"
              message={getStandardErrorMessage(mutation.error)}
              onRetry={() =>
                mutation.mutate({ seeds, hl, gl, groups })
              }
              isRetrying={mutation.isPending}
            />
          ) : null}
        </CardContent>
      </Card>

      {mutation.data ? (
        <DataTable
          table={table}
          empty={{
            title: "No suggestions found",
            description: `Google returned nothing for these expansions in ${gl.toUpperCase()}. Try a broader seed.`,
          }}
          toolbar={
            <div className="flex w-full items-center justify-between gap-2">
              <span className="text-sm tabular-nums text-muted-foreground">
                {rows.length.toLocaleString("en-US")} keywords from{" "}
                {mutation.data.queriesRun.toLocaleString("en-US")} queries
              </span>
              <ExportMenu
                actions={["sheets", "csv", "json"]}
                onExport={onExport}
              />
            </div>
          }
        />
      ) : (
        !mutation.isPending && (
          <EmptyState
            variant="plain"
            title="Enter a seed to mine suggestions"
            description="Each modifier runs twice — once before and once after your seed — against live Google autocomplete."
          />
        )
      )}
    </div>
  );
}
