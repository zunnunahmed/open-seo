import { createColumnHelper, type ColumnDef } from "@tanstack/react-table";
import { SortableHeader } from "@/client/components/table/SortableHeader";
import { Badge } from "@/client/components/ui/badge";
import {
  nullableNumberSort,
  type PageRow,
} from "@/client/features/audit/results/AuditResultsTableFilterLogic";
import { classifyGscUrl } from "@/client/features/search-performance/urlCategories";

const gscColumnHelper = createColumnHelper<PageRow>();

const CATEGORY_BADGE = {
  Performance: "success",
  Good: "info",
  Fair: "secondary",
  Weak: "warning",
  Dead: "destructive",
} as const;

/**
 * Search Console columns for the audit Pages table: 28-day clicks and
 * impressions, top queries, click category and Google index status. All
 * best-effort — pages without GSC rows show a muted fallback instead.
 */
export function buildGscColumns(): ColumnDef<PageRow>[] {
  return [
    gscColumnHelper.accessor((row) => row.gscClicks ?? null, {
      id: "gscClicks",
      meta: { cellClassName: "whitespace-nowrap text-right tabular-nums" },
      header: ({ column }) => (
        <SortableHeader
          column={column}
          label="Clicks"
          align="right"
          title="Search Console clicks, last 28 days"
        />
      ),
      cell: ({ getValue }) => {
        const value = getValue();
        return value == null ? (
          <span className="text-xs text-muted-foreground">No clicks</span>
        ) : (
          <span className="text-xs tabular-nums">{value.toLocaleString("en-US")}</span>
        );
      },
      sortingFn: nullableNumberSort,
    }),
    gscColumnHelper.accessor((row) => row.gscImpressions ?? null, {
      id: "gscImpressions",
      meta: { cellClassName: "whitespace-nowrap text-right tabular-nums" },
      header: ({ column }) => (
        <SortableHeader
          column={column}
          label="Impressions"
          align="right"
          title="Search Console impressions, last 28 days"
        />
      ),
      cell: ({ getValue }) => {
        const value = getValue();
        return value == null ? (
          <span className="text-xs text-muted-foreground">No impression</span>
        ) : (
          <span className="text-xs tabular-nums">{value.toLocaleString("en-US")}</span>
        );
      },
      sortingFn: nullableNumberSort,
    }),
    gscColumnHelper.accessor((row) => row.gscTopImpressions ?? null, {
      id: "gscTopImpressionQuery",
      meta: { cellClassName: "whitespace-nowrap" },
      header: ({ column }) => (
        <SortableHeader
          column={column}
          label="Top impression query"
          title="Highest-impression Search Console query for this page, last 28 days"
        />
      ),
      cell: ({ getValue, row }) => {
        const query = row.original.gscTopImpressionQuery;
        const impressions = getValue();
        if (query == null || impressions == null) {
          return (
            <span className="text-xs text-muted-foreground">No data</span>
          );
        }
        return (
          <span
            className="block max-w-[220px] truncate text-xs"
            title={`${query} — ${impressions.toLocaleString("en-US")} impressions`}
          >
            {query}
          </span>
        );
      },
      sortingFn: nullableNumberSort,
    }),
    gscColumnHelper.accessor((row) => row.gscTopClicks ?? null, {
      id: "gscTopClickQuery",
      meta: { cellClassName: "whitespace-nowrap" },
      header: ({ column }) => (
        <SortableHeader
          column={column}
          label="Top click query"
          title="Highest-click Search Console query for this page, last 28 days"
        />
      ),
      cell: ({ getValue, row }) => {
        const query = row.original.gscTopClickQuery;
        const clicks = getValue();
        if (query == null || clicks == null) {
          return (
            <span className="text-xs text-muted-foreground">No data</span>
          );
        }
        return (
          <span
            className="block max-w-[220px] truncate text-xs"
            title={`${query} — ${clicks.toLocaleString("en-US")} clicks`}
          >
            {query}
          </span>
        );
      },
      sortingFn: nullableNumberSort,
    }),
    gscColumnHelper.accessor((row) => row.gscClicks ?? null, {
      id: "gscCategory",
      meta: { cellClassName: "whitespace-nowrap" },
      header: ({ column }) => (
        <SortableHeader
          column={column}
          label="Category"
          title="GSC click category, last 28 days: Performance, Good, Fair, Weak or Dead"
        />
      ),
      cell: ({ getValue }) => {
        const clicks = getValue();
        if (clicks == null) {
          return (
            <span className="text-xs text-muted-foreground">No data</span>
          );
        }
        const { category, action } = classifyGscUrl(clicks);
        return (
          <Badge variant={CATEGORY_BADGE[category]} size="sm" title={action}>
            {category}
          </Badge>
        );
      },
      sortingFn: nullableNumberSort,
    }),
    gscColumnHelper.accessor((row) => row.gscIndexStatus ?? "Not checked", {
      id: "gscIndexStatus",
      meta: { cellClassName: "whitespace-nowrap" },
      header: ({ column }) => (
        <SortableHeader
          column={column}
          label="Indexed"
          title="Google index status via Search Console URL Inspection"
        />
      ),
      cell: ({ getValue, row }) => {
        const value = getValue();
        const reason =
          (row.original as { gscIndexReason?: string | null })
            .gscIndexReason ?? undefined;
        if (value === "Indexed") {
          return (
            <Badge variant="success" size="sm" title={reason}>
              Indexed
            </Badge>
          );
        }
        if (value === "Not indexed") {
          return (
            <Badge variant="destructive" size="sm" title={reason}>
              Not indexed
            </Badge>
          );
        }
        return (
          <Badge
            variant={value === "Check failed" ? "warning" : "outline"}
            size="sm"
            title={reason}
          >
            {value}
          </Badge>
        );
      },
    }),
  ];
}
