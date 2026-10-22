import { useMemo } from "react";
import { createColumnHelper } from "@tanstack/react-table";
import { Badge } from "@/client/components/ui/badge";
import { SortableHeader } from "@/client/components/table/SortableHeader";
import { DataTable, useDataTable } from "@/client/components/table/DataTable";
import { ExportMenu } from "@/client/components/ExportMenu";
import { exportRows } from "@/client/lib/exportRows";
import { FREE_HEADERS, type SuggestionRow } from "./suggestionOptions";

const columnHelper = createColumnHelper<SuggestionRow>();

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
    columnHelper.accessor("seed", {
      header: ({ column }) => <SortableHeader column={column} label="Seed" />,
      meta: { cellClassName: "whitespace-nowrap" },
    }),
  ];
}

export function SuggestionsFreeResults({
  rows,
  queriesRun,
  countryName,
}: {
  rows: SuggestionRow[];
  queriesRun: number;
  countryName: string;
}) {
  const columns = useMemo(buildColumns, []);
  const table = useDataTable({ data: rows, columns, withSorting: true });

  return (
    <DataTable
      table={table}
      empty={{
        title: "No suggestions found",
        description: `Google returned nothing for these expansions in ${countryName}. Try a broader seed.`,
      }}
      toolbar={
        <div className="flex w-full items-center justify-between gap-2">
          <span className="text-sm tabular-nums text-muted-foreground">
            {rows.length.toLocaleString("en-US")} keywords from{" "}
            {queriesRun.toLocaleString("en-US")} queries · Source: Google
          </span>
          {rows.length > 0 ? (
            <ExportMenu
              actions={["sheets", "csv", "json"]}
              onExport={(format) => {
                void exportRows({
                  format,
                  feature: "search_suggestions",
                  headers: FREE_HEADERS,
                  rows: rows.map((row) => [
                    row.keyword,
                    row.placement,
                    row.modifier,
                    row.query,
                  ]),
                  filename: "search-suggestions",
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
