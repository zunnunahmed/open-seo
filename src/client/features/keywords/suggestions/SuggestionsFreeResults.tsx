import { useMemo, useState, type ReactNode } from "react";
import { createColumnHelper, type SortingState } from "@tanstack/react-table";
import { Badge } from "@/client/components/ui/badge";
import { Card } from "@/client/components/ui/card";
import { Separator } from "@/client/components/ui/separator";
import { SortableHeader } from "@/client/components/table/SortableHeader";
import { DataTable, useDataTable } from "@/client/components/table/DataTable";
import { DataTableToolbar } from "@/client/components/table/DataTableToolbar";
import { TablePagination } from "@/client/components/table/TablePagination";
import { ExportMenu } from "@/client/components/ExportMenu";
import { exportRows } from "@/client/lib/exportRows";
import { FREE_HEADERS, type SuggestionRow } from "./suggestionOptions";

const columnHelper = createColumnHelper<SuggestionRow>();

const PAGE_SIZES = [25, 50, 100] as const;

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
          <Badge
            variant="soft"
            size="sm"
            title="Modifier added before the seed"
          >
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}

export function SuggestionsFreeResults({
  rows,
  queriesRun,
  countryName,
  actions,
}: {
  rows: SuggestionRow[];
  queriesRun: number;
  countryName: string;
  /** Extra toolbar buttons, shown before Export. */
  actions?: ReactNode;
}) {
  const columns = useMemo(buildColumns, []);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(
    PAGE_SIZES[1] as (typeof PAGE_SIZES)[number],
  );
  const [sorting, setSorting] = useState<SortingState>([]);
  const before = useMemo(
    () => rows.filter((row) => row.placement === "before").length,
    [rows],
  );
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
      <Card className="shrink-0 flex-row items-center gap-4 px-4 py-2.5">
        <Stat label="Keywords" value={rows.length.toLocaleString("en-US")} />
        <Separator orientation="vertical" className="h-6" />
        <div className="flex min-w-0 flex-wrap items-center gap-4">
          <Stat label="Before" value={before.toLocaleString("en-US")} />
          <Stat
            label="After"
            value={(rows.length - before).toLocaleString("en-US")}
          />
          <Stat
            label="Queries run"
            value={queriesRun.toLocaleString("en-US")}
          />
        </div>
      </Card>
      <DataTable
        table={table}
        empty={{
          title: "No suggestions found",
          description: `Google returned nothing for these expansions in ${countryName}. Try a broader seed.`,
        }}
        toolbar={
          <DataTableToolbar
            actions={
              <>
                {actions}
                <ExportMenu
                  actions={["sheets", "csv", "json"]}
                  disabled={rows.length === 0}
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
              </>
            }
          >
            <span className="text-sm tabular-nums text-muted-foreground">
              {rows.length === 1
                ? "1 keyword"
                : `${rows.length.toLocaleString("en-US")} keywords`}{" "}
              · Source: Google
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
