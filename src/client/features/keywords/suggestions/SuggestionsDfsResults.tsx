import { useMemo, useState } from "react";
import { createColumnHelper, type SortingState } from "@tanstack/react-table";
import { Badge } from "@/client/components/ui/badge";
import { Card } from "@/client/components/ui/card";
import { Separator } from "@/client/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/client/components/ui/alert";
import { SortableHeader } from "@/client/components/table/SortableHeader";
import { ScoreBadge } from "@/client/components/table/ScoreBadge";
import { DataTable, useDataTable } from "@/client/components/table/DataTable";
import { DataTableToolbar } from "@/client/components/table/DataTableToolbar";
import { TablePagination } from "@/client/components/table/TablePagination";
import { ExportMenu } from "@/client/components/ExportMenu";
import { exportRows } from "@/client/lib/exportRows";
import { IntentBadge } from "@/client/features/keywords/components";
import { DFS_HEADERS, type DfsSuggestionRow } from "./suggestionOptions";

const columnHelper = createColumnHelper<DfsSuggestionRow>();

const PAGE_SIZES = [25, 50, 100] as const;

function formatCount(value: number | null): string {
  return value == null ? "-" : value.toLocaleString("en-US");
}

function buildColumns() {
  return [
    columnHelper.accessor("keyword", {
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
    columnHelper.accessor("placement", {
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
    columnHelper.accessor("modifier", {
      header: ({ column }) => (
        <SortableHeader column={column} label="Modifier" />
      ),
      meta: { cellClassName: "whitespace-nowrap" },
    }),
    columnHelper.accessor("searchVolume", {
      header: ({ column }) => (
        <SortableHeader column={column} label="Volume" align="right" />
      ),
      cell: ({ getValue }) => (
        <span className="text-xs tabular-nums">{formatCount(getValue())}</span>
      ),
      meta: { cellClassName: "whitespace-nowrap text-right tabular-nums" },
    }),
    columnHelper.accessor("cpc", {
      header: ({ column }) => (
        <SortableHeader column={column} label="CPC" align="right" />
      ),
      cell: ({ getValue }) => {
        const value = getValue();
        return (
          <span className="text-xs tabular-nums">
            {value == null ? "-" : `$${value.toFixed(2)}`}
          </span>
        );
      },
      meta: { cellClassName: "whitespace-nowrap text-right tabular-nums" },
    }),
    columnHelper.accessor("competition", {
      header: ({ column }) => (
        <SortableHeader column={column} label="Comp" align="right" />
      ),
      cell: ({ getValue }) => {
        const value = getValue();
        return (
          <span className="text-xs tabular-nums">
            {value == null ? "-" : `${Math.round(value * 100)}%`}
          </span>
        );
      },
      meta: { cellClassName: "whitespace-nowrap text-right tabular-nums" },
    }),
    columnHelper.accessor("keywordDifficulty", {
      header: ({ column }) => (
        <SortableHeader column={column} label="KD" align="right" />
      ),
      cell: ({ getValue }) => <ScoreBadge value={getValue()} />,
      meta: { cellClassName: "whitespace-nowrap text-right" },
    }),
    columnHelper.accessor("intent", {
      header: ({ column }) => (
        <SortableHeader column={column} label="Intent" />
      ),
      cell: ({ getValue }) => <IntentBadge intent={getValue()} />,
      meta: { cellClassName: "whitespace-nowrap" },
    }),
    columnHelper.accessor("seed", {
      header: ({ column }) => <SortableHeader column={column} label="Seed" />,
      meta: { cellClassName: "whitespace-nowrap" },
    }),
  ];
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}

export function SuggestionsDfsResults({
  rows,
  metricsError,
  sourceLabel,
}: {
  rows: DfsSuggestionRow[];
  metricsError: string | null;
  /** The project's provider route, e.g. "treg → Serpstat". */
  sourceLabel: string;
}) {
  const columns = useMemo(buildColumns, []);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(
    PAGE_SIZES[1] as (typeof PAGE_SIZES)[number],
  );
  const [sorting, setSorting] = useState<SortingState>([]);
  const withVolume = useMemo(
    () => rows.filter((row) => row.searchVolume != null),
    [rows],
  );
  const avgVolume = useMemo(() => {
    if (withVolume.length === 0) return null;
    return Math.round(
      withVolume.reduce((sum, row) => sum + (row.searchVolume ?? 0), 0) /
        withVolume.length,
    );
  }, [withVolume]);
  // Sort every row, then page: sorting only the visible page would reorder
  // 50 rows and leave the rest unsorted.
  const table = useDataTable({
    data: rows,
    columns,
    withSorting: true,
    withPagination: true,
    autoResetPageIndex: false,
    state: { sorting, pagination: { pageIndex: page, pageSize } },
    onSortingChange: (updater) => {
      setSorting(updater);
      setPage(0);
    },
  });

  return (
    <div className="flex flex-col gap-4">
      {metricsError ? (
        <Alert variant="warning">
          <AlertTitle>Volumes unavailable</AlertTitle>
          <AlertDescription>
            Showing suggestions without volume, CPC, competition, difficulty
            and intent ({metricsError}). The keyword list itself is complete —
            try again for metrics.
          </AlertDescription>
        </Alert>
      ) : null}
      <Card className="shrink-0 flex-row items-center gap-4 px-4 py-2.5">
        <Stat label="Keywords" value={rows.length.toLocaleString("en-US")} />
        <Separator orientation="vertical" className="h-6" />
        <div className="flex min-w-0 flex-wrap items-center gap-4">
          <Stat
            label="With volume"
            value={`${withVolume.length.toLocaleString("en-US")} (${rows.length === 0 ? 0 : Math.round((withVolume.length / rows.length) * 100)}%)`}
          />
          <Stat
            label="Avg volume"
            value={avgVolume == null ? "-" : avgVolume.toLocaleString("en-US")}
          />
        </div>
      </Card>
      <DataTable
        table={table}
        empty={{
          title: "No suggestions found",
          description: `${sourceLabel} returned nothing for these expansions in your project market.`,
        }}
        toolbar={
          <DataTableToolbar
            actions={
              <ExportMenu
                actions={["sheets", "csv", "json"]}
                disabled={rows.length === 0}
                onExport={(format) => {
                  void exportRows({
                    format,
                    feature: "search_suggestions",
                    headers: DFS_HEADERS,
                    rows: rows.map((row) => [
                      row.keyword,
                      row.placement,
                      row.modifier,
                      row.searchVolume ?? "No data",
                      row.cpc ?? "No data",
                      row.competition ?? "No data",
                      row.keywordDifficulty ?? "No data",
                      row.intent,
                      row.seed,
                    ]),
                    filename: "search-suggestions-dataforseo",
                    records: rows,
                  });
                }}
              />
            }
          >
            <span className="text-sm tabular-nums text-muted-foreground">
              {rows.length === 1
                ? "1 keyword"
                : `${rows.length.toLocaleString("en-US")} keywords`}{" "}
              · Source: {sourceLabel}
            </span>
          </DataTableToolbar>
        }
        footer={
          rows.length > 0 ? (
            <TablePagination
              page={page + 1}
              pageSize={pageSize}
              pageSizes={PAGE_SIZES}
              totalCount={rows.length}
              onPageChange={(next) => setPage(next - 1)}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(0);
              }}
            />
          ) : undefined
        }
      />
    </div>
  );
}
