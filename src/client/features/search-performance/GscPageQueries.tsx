import { useMemo, useState } from "react";
import { createColumnHelper, type SortingState } from "@tanstack/react-table";
import { Input } from "@/client/components/ui/input";
import { SortableHeader } from "@/client/components/table/SortableHeader";
import { DataTable, useDataTable } from "@/client/components/table/DataTable";
import { DataTableToolbar } from "@/client/components/table/DataTableToolbar";
import { TablePagination } from "@/client/components/table/TablePagination";
import { ExportMenu } from "@/client/components/ExportMenu";
import { exportRows } from "@/client/lib/exportRows";
import {
  formatCount,
  formatCtr,
  formatPosition,
} from "./SearchPerformanceColumns";

type QueryRow = {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

const helper = createColumnHelper<QueryRow>();
const PAGE_SIZES = [25, 50, 100] as const;
const right = {
  headerClassName: "text-right",
  cellClassName: "text-right tabular-nums",
} as const;

function buildColumns(onCheckSerp: (query: string) => void) {
  return [
    helper.display({
      id: "rowNumber",
      header: "#",
      cell: ({ row, table }) =>
        table
          .getSortedRowModel()
          .rows.findIndex((shown) => shown.id === row.id) + 1,
      meta: { cellClassName: "w-10 tabular-nums text-muted-foreground" },
    }),
    helper.accessor("query", {
      header: ({ column }) => <SortableHeader column={column} label="Query" />,
      cell: ({ getValue }) => (
        <button
          type="button"
          className="block max-w-sm truncate text-left text-primary underline-offset-4 hover:underline"
          title={`${getValue()}: check its live Google results`}
          onClick={() => onCheckSerp(getValue())}
        >
          {getValue()}
        </button>
      ),
    }),
    helper.accessor("clicks", {
      header: ({ column }) => (
        <SortableHeader column={column} label="Clicks" align="right" />
      ),
      cell: ({ getValue }) => formatCount(getValue()),
      meta: right,
    }),
    helper.accessor("impressions", {
      header: ({ column }) => (
        <SortableHeader column={column} label="Impressions" align="right" />
      ),
      cell: ({ getValue }) => formatCount(getValue()),
      meta: right,
    }),
    helper.accessor("ctr", {
      header: ({ column }) => (
        <SortableHeader column={column} label="CTR" align="right" />
      ),
      cell: ({ getValue }) => formatCtr(getValue()),
      meta: right,
    }),
    helper.accessor("position", {
      header: ({ column }) => (
        <SortableHeader column={column} label="Position" align="right" />
      ),
      cell: ({ getValue }) => formatPosition(getValue()),
      meta: right,
    }),
  ];
}

/** Every query Google showed one page for, searchable and exportable. */
export function GscPageQueries({
  page,
  queries,
  onCheckSerp,
}: {
  page: string;
  queries: QueryRow[];
  /** Check a query's live Google results in the panel's SERP section. */
  onCheckSerp: (query: string) => void;
}) {
  const columns = useMemo(() => buildColumns(onCheckSerp), [onCheckSerp]);
  const [search, setSearch] = useState("");
  const [sorting, setSorting] = useState<SortingState>([
    { id: "clicks", desc: true },
  ]);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0]);
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return needle
      ? queries.filter((row) => row.query.toLowerCase().includes(needle))
      : queries;
  }, [queries, search]);
  const table = useDataTable({
    data: visible,
    columns,
    withSorting: true,
    withPagination: true,
    autoResetPageIndex: false,
    state: { sorting, pagination: { pageIndex, pageSize } },
    onSortingChange: (updater) => {
      setSorting(updater);
      setPageIndex(0);
    },
  });

  return (
    <DataTable
      table={table}
      empty={{
        title: search ? "No matching queries" : "No queries in this range",
        description: search
          ? "Try another word."
          : "Google showed this page for no queries in the selected range.",
      }}
      toolbar={
        <DataTableToolbar
          actions={
            <ExportMenu
              actions={["sheets", "csv", "json"]}
              disabled={visible.length === 0}
              onExport={(format) => {
                void exportRows({
                  format,
                  feature: "gsc_page_queries",
                  headers: [
                    "Query",
                    "Clicks",
                    "Impressions",
                    "CTR",
                    "Position",
                  ],
                  rows: visible.map((row) => [
                    row.query,
                    row.clicks,
                    row.impressions,
                    Number((row.ctr * 100).toFixed(2)),
                    Number(row.position.toFixed(1)),
                  ]),
                  filename: `gsc-queries-${new URL(page).pathname.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "home"}`,
                  records: visible,
                });
              }}
            />
          }
        >
          <Input
            className="h-8 w-56"
            value={search}
            placeholder="Search queries"
            aria-label="Search queries"
            onChange={(event) => {
              setSearch(event.target.value);
              setPageIndex(0);
            }}
          />
        </DataTableToolbar>
      }
      footer={
        visible.length > 0 ? (
          <TablePagination
            page={pageIndex + 1}
            pageSize={pageSize}
            pageSizes={PAGE_SIZES}
            totalCount={visible.length}
            onPageChange={(next) => setPageIndex(next - 1)}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPageIndex(0);
            }}
          />
        ) : undefined
      }
    />
  );
}
