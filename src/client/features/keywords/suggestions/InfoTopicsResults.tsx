import { useMemo, useState, type ReactNode } from "react";
import { createColumnHelper, type SortingState } from "@tanstack/react-table";
import { Badge } from "@/client/components/ui/badge";
import { SortableHeader } from "@/client/components/table/SortableHeader";
import { ScoreBadge } from "@/client/components/table/ScoreBadge";
import { DataTable, useDataTable } from "@/client/components/table/DataTable";
import { DataTableToolbar } from "@/client/components/table/DataTableToolbar";
import { TablePagination } from "@/client/components/table/TablePagination";
import { ExportMenu } from "@/client/components/ExportMenu";
import { exportRows } from "@/client/lib/exportRows";
import { IntentBadge } from "@/client/features/keywords/components";
import type { KeywordIntent } from "@/types/keywords";
import type { InfoTopicRow } from "@/shared/infoTopics";

const columnHelper = createColumnHelper<InfoTopicRow>();
const PAGE_SIZES = [25, 50, 100] as const;

const INTENTS: KeywordIntent[] = [
  "informational",
  "commercial",
  "transactional",
  "navigational",
];
const toIntent = (value: string | null): KeywordIntent =>
  INTENTS.find((intent) => intent === value) ?? "unknown";

const MATCH_LABEL = {
  existing: { label: "Topic is a keyword", variant: "success" },
  word: { label: "Word match", variant: "soft" },
  ai: { label: "AI match", variant: "info" },
} as const;

const HEADERS = [
  "Original topic",
  "Info topic",
  "Search volume",
  "Keyword difficulty",
  "CPC",
  "Intent",
  "Matched by",
  "Found via",
  "Ranking URL",
  "URL position",
  "AI Overview",
];

const count = (value: number | null) =>
  value == null ? "-" : value.toLocaleString("en-US");

const columns = [
  columnHelper.accessor("topic", {
    header: ({ column }) => (
      <SortableHeader column={column} label="Original topic" />
    ),
    cell: ({ getValue }) => <span className="font-medium">{getValue()}</span>,
  }),
  columnHelper.accessor((row) => row.infoTopic ?? "", {
    id: "infoTopic",
    header: ({ column }) => (
      <SortableHeader column={column} label="Info topic" />
    ),
    cell: ({ row }) =>
      row.original.infoTopic ?? (
        <span className="text-muted-foreground">No match in top 3</span>
      ),
  }),
  columnHelper.accessor((row) => row.volume ?? -1, {
    id: "volume",
    header: ({ column }) => (
      <SortableHeader column={column} label="Volume" align="right" />
    ),
    cell: ({ row }) => count(row.original.volume),
    meta: { cellClassName: "text-right tabular-nums" },
  }),
  columnHelper.accessor((row) => row.difficulty ?? -1, {
    id: "difficulty",
    header: ({ column }) => <SortableHeader column={column} label="KD" />,
    cell: ({ row }) => <ScoreBadge value={row.original.difficulty} />,
  }),
  columnHelper.accessor((row) => row.cpc ?? -1, {
    id: "cpc",
    header: ({ column }) => (
      <SortableHeader column={column} label="CPC" align="right" />
    ),
    cell: ({ row }) =>
      row.original.cpc == null ? "-" : `$${row.original.cpc.toFixed(2)}`,
    meta: { cellClassName: "text-right tabular-nums" },
  }),
  columnHelper.accessor("intent", {
    header: "Intent",
    cell: ({ getValue }) =>
      getValue() ? <IntentBadge intent={toIntent(getValue())} /> : "-",
  }),
  columnHelper.accessor("matchedBy", {
    header: "Matched by",
    cell: ({ row }) => {
      const match = row.original.matchedBy;
      if (!match) return "-";
      return (
        <div className="space-y-0.5 text-xs">
          <Badge variant={MATCH_LABEL[match].variant} size="sm">
            {MATCH_LABEL[match].label}
          </Badge>
          {row.original.urlRank ? (
            <div className="text-muted-foreground">
              Google result #{row.original.urlRank}
              {row.original.position
                ? ` · ranks #${row.original.position}`
                : ""}
            </div>
          ) : null}
        </div>
      );
    },
  }),
  columnHelper.accessor("url", {
    header: "Ranking URL",
    cell: ({ getValue }) => {
      const url = getValue();
      return url ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer noopener"
          className="block max-w-[260px] truncate text-xs hover:underline"
          title={url}
        >
          {url.replace(/^https?:\/\/(www\.)?/, "")}
        </a>
      ) : (
        "-"
      );
    },
  }),
  columnHelper.accessor((row) => (row.aiOverview ? 1 : 0), {
    id: "aiOverview",
    header: ({ column }) => (
      <SortableHeader column={column} label="AI Overview" />
    ),
    cell: ({ row }) =>
      row.original.aiOverview == null
        ? "-"
        : row.original.aiOverview
          ? "Yes"
          : "No",
  }),
];

/** Info topics for a run, fresh or saved. */
export function InfoTopicsResults({
  rows,
  countryName,
  actions,
}: {
  rows: InfoTopicRow[];
  countryName: string;
  actions?: ReactNode;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[1]);
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
  const matched = useMemo(
    () => rows.filter((row) => row.infoTopic).length,
    [rows],
  );

  return (
    <DataTable
      table={table}
      empty={{
        title: "No topics yet",
        description: "Add topics above and run the extraction.",
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
                    feature: "info_topics",
                    headers: HEADERS,
                    rows: rows.map((row) => [
                      row.topic,
                      row.infoTopic ?? "No match in top 3",
                      row.volume ?? "",
                      row.difficulty ?? "",
                      row.cpc ?? "",
                      row.intent ?? "",
                      row.matchedBy ? MATCH_LABEL[row.matchedBy].label : "",
                      row.urlRank ? `Google result #${row.urlRank}` : "",
                      row.url ?? "",
                      row.position ?? "",
                      row.aiOverview == null
                        ? ""
                        : row.aiOverview
                          ? "Yes"
                          : "No",
                    ]),
                    filename: "info-topics",
                    records: rows,
                  });
                }}
              />
            </>
          }
        >
          <span className="text-sm tabular-nums text-muted-foreground">
            {matched.toLocaleString("en-US")} of{" "}
            {rows.length.toLocaleString("en-US")} topics matched · {countryName}
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
  );
}
