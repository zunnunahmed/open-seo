import { useMemo } from "react";
import { createColumnHelper } from "@tanstack/react-table";
import { SortableHeader } from "@/client/components/table/SortableHeader";
import { ScoreBadge } from "@/client/components/table/ScoreBadge";
import { DataTable, useDataTable } from "@/client/components/table/DataTable";
import { ExportMenu } from "@/client/components/ExportMenu";
import { exportRows } from "@/client/lib/exportRows";
import { IntentBadge } from "@/client/features/keywords/components";
import { DFS_HEADERS, type DfsSuggestionRow } from "./suggestionOptions";

const columnHelper = createColumnHelper<DfsSuggestionRow>();

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
    columnHelper.accessor("searchVolume", {
      header: ({ column }) => (
        <SortableHeader column={column} label="Volume" align="right" />
      ),
      cell: ({ getValue }) => (
        <span className="text-xs tabular-nums">
          {formatCount(getValue())}
        </span>
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

export function SuggestionsDfsResults({
  rows,
}: {
  rows: DfsSuggestionRow[];
}) {
  const columns = useMemo(buildColumns, []);
  const table = useDataTable({ data: rows, columns, withSorting: true });

  return (
    <DataTable
      table={table}
      empty={{
        title: "No suggestions found",
        description:
          "DataForSEO returned nothing for these seeds in your project market.",
      }}
      toolbar={
        <div className="flex w-full items-center justify-between gap-2">
          <span className="text-sm tabular-nums text-muted-foreground">
            {rows.length.toLocaleString("en-US")} keywords · Source: DataForSEO
          </span>
          {rows.length > 0 ? (
            <ExportMenu
              actions={["sheets", "csv", "json"]}
              onExport={(format) => {
                void exportRows({
                  format,
                  feature: "search_suggestions",
                  headers: DFS_HEADERS,
                  rows: rows.map((row) => [
                    row.keyword,
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
          ) : null}
        </div>
      }
    />
  );
}
