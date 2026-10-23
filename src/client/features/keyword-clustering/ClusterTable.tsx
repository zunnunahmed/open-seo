import { useMemo, useState } from "react";
import { createColumnHelper, type SortingState } from "@tanstack/react-table";
import { ChevronRight } from "lucide-react";
import { SortableHeader } from "@/client/components/table/SortableHeader";
import { DataTable, useDataTable } from "@/client/components/table/DataTable";
import { DataTableToolbar } from "@/client/components/table/DataTableToolbar";
import { TablePagination } from "@/client/components/table/TablePagination";
import {
  isDomainOrSubdomain,
  urlDomain,
  type KeywordCluster,
} from "@/shared/keywordClustering";
import { featureLabel } from "./clusterExports";

function ClusterDetails({
  cluster,
  ownDomain,
}: {
  cluster: KeywordCluster;
  ownDomain: string | null;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div>
        <p className="mb-1 text-xs font-medium">Keywords</p>
        <ul className="space-y-0.5 text-xs">
          {cluster.keywords.map((k) => (
            <li key={k.keyword} className="flex justify-between gap-3">
              <span>{k.keyword}</span>
              <span className="tabular-nums text-muted-foreground">
                {k.volume?.toLocaleString() ?? "—"}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="mb-1 text-xs font-medium">
          URLs ranking for most of these keywords
        </p>
        <ul className="space-y-0.5 break-all text-xs">
          {cluster.sharedUrls.slice(0, 10).map((url) => (
            <li key={url}>
              <a
                href={`https://${url}`}
                target="_blank"
                rel="noreferrer noopener"
                className="underline"
                onClick={(e) => e.stopPropagation()}
              >
                {url}
              </a>
              {ownDomain && isDomainOrSubdomain(urlDomain(url), ownDomain) ? (
                <span className="ml-1 text-primary">(yours)</span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const columnHelper = createColumnHelper<KeywordCluster>();
const PAGE_SIZES = [25, 50, 100] as const;

function buildColumns(
  ownDomain: string | null,
  competitors: string[],
  hubOf: Map<number, string>,
) {
  return [
    columnHelper.accessor((cluster) => cluster.main.keyword, {
      id: "main",
      header: ({ column }) => (
        <SortableHeader column={column} label="Main keyword" />
      ),
      cell: ({ row }) => (
        <div className="font-medium">
          <span className="inline-flex items-center gap-1">
            <ChevronRight
              aria-hidden
              className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${
                row.getIsExpanded() ? "rotate-90" : ""
              }`}
            />
            {row.original.main.keyword}
          </span>
          {row.original.features.length ? (
            <div className="text-xs font-normal text-muted-foreground">
              {row.original.features.map(featureLabel).join(" · ")}
            </div>
          ) : null}
        </div>
      ),
    }),
    columnHelper.accessor((cluster) => cluster.keywords.length, {
      id: "keywords",
      header: ({ column }) => (
        <SortableHeader column={column} label="Keywords" />
      ),
      cell: ({ getValue }) => getValue().toLocaleString(),
      meta: {
        headerClassName: "text-right",
        cellClassName: "text-right tabular-nums",
      },
    }),
    columnHelper.accessor("totalVolume", {
      header: ({ column }) => <SortableHeader column={column} label="Volume" />,
      cell: ({ getValue }) => getValue().toLocaleString(),
      meta: {
        headerClassName: "text-right",
        cellClassName: "text-right tabular-nums",
      },
    }),
    columnHelper.accessor((cluster) => hubOf.get(cluster.id) ?? "", {
      id: "hub",
      header: ({ column }) => (
        <SortableHeader column={column} label="Topic hub" />
      ),
      cell: ({ getValue }) => (
        <span className="text-xs">{getValue() || "—"}</span>
      ),
    }),
    columnHelper.accessor("pageType", {
      header: ({ column }) => (
        <SortableHeader column={column} label="Page type" />
      ),
    }),
    columnHelper.display({
      id: "topDomains",
      header: "Top domains",
      cell: ({ row }) => {
        const cluster = row.original;
        const hits = competitors.filter((domain) =>
          cluster.topDomains.some((d) => isDomainOrSubdomain(d.domain, domain)),
        );
        return (
          <div className="text-xs">
            {cluster.topDomains
              .slice(0, 3)
              .map((d) => d.domain)
              .join(", ")}
            {hits.length ? (
              <div className="font-medium text-primary">
                Competitors: {hits.join(", ")}
              </div>
            ) : null}
          </div>
        );
      },
    }),
    columnHelper.display({
      id: "plan",
      header: ownDomain ? "Your page" : "Plan",
      cell: ({ row }) => {
        const urls = row.original.ownUrls;
        return (
          <span className="text-xs">
            {urls.length > 1 ? (
              <span className="text-destructive">
                Cannibalization: {urls.length} pages
              </span>
            ) : urls.length === 1 ? (
              urls[0]
            ) : (
              "New page"
            )}
          </span>
        );
      },
    }),
  ];
}

export function ClusterTable({
  clusters,
  ownDomain,
  competitors,
  hubOf,
}: {
  clusters: KeywordCluster[];
  ownDomain: string | null;
  competitors: string[];
  hubOf: Map<number, string>;
}) {
  // competitors is a fresh array each render; key the columns on its content.
  const competitorKey = competitors.join(",");
  const columns = useMemo(
    () =>
      buildColumns(
        ownDomain,
        competitorKey ? competitorKey.split(",") : [],
        hubOf,
      ),
    [ownDomain, competitorKey, hubOf],
  );
  const [sorting, setSorting] = useState<SortingState>([]);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[1]);
  const table = useDataTable({
    data: clusters,
    columns,
    withSorting: true,
    withExpanded: true,
    withPagination: true,
    autoResetPageIndex: false,
    getRowId: (cluster) => String(cluster.id),
    state: { sorting, pagination: { pageIndex: page, pageSize } },
    onSortingChange: (updater) => {
      setSorting(updater);
      setPage(0);
    },
  });

  return (
    <DataTable
      table={table}
      empty={{
        title: "No clusters at this threshold",
        description: "Lower the number of shared URLs or switch to soft mode.",
      }}
      onRowClick={(row) => row.toggleExpanded()}
      renderExpandedRow={(row) => (
        <ClusterDetails cluster={row.original} ownDomain={ownDomain} />
      )}
      toolbar={
        <DataTableToolbar>
          <span className="text-sm tabular-nums text-muted-foreground">
            {clusters.length.toLocaleString()} clusters · click a row for its
            keywords and URLs
          </span>
        </DataTableToolbar>
      }
      footer={
        clusters.length > 0 ? (
          <TablePagination
            page={page + 1}
            pageSize={pageSize}
            pageSizes={PAGE_SIZES}
            totalCount={clusters.length}
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
