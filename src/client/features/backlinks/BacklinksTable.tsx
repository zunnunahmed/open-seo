import { useMemo } from "react";
import type { OnChangeFn, Row, SortingState } from "@tanstack/react-table";
import {
  DataTable,
  useDataTable,
  type DataTableFrameProps,
} from "@/client/components/table/DataTable";
import {
  buildBacklinksColumns,
  type BacklinksDisplayRow,
} from "./BacklinksTableColumns";
import type { BacklinksRow } from "./backlinksPageTypes";
import type { BacklinksDomainExpansion } from "./useBacklinksDomainExpansion";
import type { DomainRatings } from "./useAhrefsDomainRatings";
import {
  AddProspectButton,
  type AddToProspects,
} from "@/client/features/outreach/AddProspectButton";

/** Interleaves expanded domains' extra links beneath their page row. */
function buildDisplayRows(
  rows: BacklinksRow[],
  expansion: BacklinksDomainExpansion | null,
): BacklinksDisplayRow[] {
  if (!expansion) {
    return rows.map((row) => ({
      kind: "link",
      row,
      depth: 0,
      expandable: false,
      expanded: false,
    }));
  }

  const out: BacklinksDisplayRow[] = [];
  for (const row of rows) {
    const domain = row.domainFrom;
    const expanded = Boolean(domain && expansion.expandedDomains.has(domain));
    out.push({
      kind: "link",
      row,
      depth: 0,
      expandable: Boolean(domain),
      expanded,
    });
    if (!expanded || !domain) continue;

    const entry = expansion.entriesByDomain[domain];
    if (!entry || entry.status === "loading") {
      out.push({ kind: "status", domain, status: "loading" });
    } else if (entry.status === "error") {
      out.push({ kind: "status", domain, status: "error" });
    } else {
      // The page row already shows the domain's strongest link; list the rest.
      const children = entry.rows.filter(
        (child) =>
          !(
            child.urlFrom === row.urlFrom &&
            child.urlTo === row.urlTo &&
            child.anchor === row.anchor
          ),
      );
      if (children.length === 0) {
        out.push({ kind: "status", domain, status: "empty" });
      } else {
        for (const child of children) {
          out.push({
            kind: "link",
            row: child,
            depth: 1,
            expandable: false,
            expanded: false,
          });
        }
      }
    }
  }
  return out;
}

function tintExpandedRow(row: Row<BacklinksDisplayRow>) {
  const displayRow = row.original;
  return displayRow.kind !== "link" || displayRow.depth > 0
    ? "bg-muted/50"
    : undefined;
}

export function BacklinksTable({
  rows,
  domainRatings,
  sorting,
  onSortingChange,
  expansion,
  prospects,
  ...frame
}: DataTableFrameProps & {
  rows: BacklinksRow[];
  domainRatings: DomainRatings | null;
  sorting: SortingState;
  onSortingChange: OnChangeFn<SortingState>;
  /** Present in the one-per-domain view; null when listing all links. */
  expansion: BacklinksDomainExpansion | null;
  /** Adds a row's linking site to Outreach → Link Prospects. */
  prospects?: AddToProspects;
}) {
  const columns = useMemo(() => {
    const base = buildBacklinksColumns(domainRatings, expansion?.toggleDomain);
    const withProspects: typeof base = prospects
      ? [
          ...base,
          {
            id: "prospect",
            header: () => <span className="sr-only">Link Prospects</span>,
            enableSorting: false,
            cell: ({ row }) => {
              const displayRow = row.original;
              if (displayRow.kind !== "link" || !displayRow.row.domainFrom)
                return null;
              return (
                <AddProspectButton
                  prospects={prospects}
                  candidate={{
                    domain: displayRow.row.domainFrom,
                    sourceUrl: displayRow.row.urlFrom,
                    authority: displayRow.row.domainFromRank,
                  }}
                />
              );
            },
          },
        ]
      : base;
    return withProspects.map((column) => ({
      ...column,
      // Tints a domain's expanded links and its status row.
      meta: { ...column.meta, cellClassName: tintExpandedRow },
    }));
  }, [domainRatings, expansion?.toggleDomain, prospects]);
  const displayRows = useMemo(
    () => buildDisplayRows(rows, expansion),
    [rows, expansion],
  );

  const table = useDataTable({
    data: displayRows,
    columns,
    state: { sorting },
    onSortingChange,
    manualSorting: true,
  });

  return (
    <DataTable
      table={table}
      empty={{ title: "No backlinks found for this target." }}
      {...frame}
    />
  );
}
