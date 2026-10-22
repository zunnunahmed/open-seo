import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { createColumnHelper, type SortingState } from "@tanstack/react-table";
import { Button } from "@/client/components/ui/button";
import { SortableHeader } from "@/client/components/table/SortableHeader";
import { DataTable, useDataTable } from "@/client/components/table/DataTable";
import { DataTableToolbar } from "@/client/components/table/DataTableToolbar";
import { TablePagination } from "@/client/components/table/TablePagination";
import { getTregSavedList } from "@/serverFunctions/tregLists";
import type {
  TregListKind,
  TregListSnapshot,
} from "@/server/custom/providers/treg/lists";

type TregListRow = TregListSnapshot["rows"][number];
const columnHelper = createColumnHelper<TregListRow>();
const PAGE_SIZES = [25, 50, 100] as const;
const dash = (value: string | number | null | undefined) => value ?? "—";

function buildColumns(kind: TregListKind) {
  return [
    columnHelper.accessor("source", {
      header: ({ column }) => <SortableHeader column={column} label="Source" />,
      cell: ({ getValue }) => {
        const source = getValue();
        return source.startsWith("https://") ? (
          <a
            className="break-all underline"
            href={source}
            target="_blank"
            rel="noopener noreferrer"
          >
            {source}
          </a>
        ) : (
          <span className="break-all">{source}</span>
        );
      },
    }),
    ...(kind === "backlinks"
      ? [
          columnHelper.accessor("target", {
            header: ({ column }) => (
              <SortableHeader column={column} label="Target" />
            ),
            cell: ({ getValue }) => (
              <span className="break-all">{dash(getValue())}</span>
            ),
          }),
          columnHelper.accessor("anchor", {
            header: ({ column }) => (
              <SortableHeader column={column} label="Anchor" />
            ),
            cell: ({ getValue }) => dash(getValue()),
          }),
          columnHelper.accessor("linkType", {
            header: ({ column }) => (
              <SortableHeader column={column} label="Follow" />
            ),
            cell: ({ getValue }) => dash(getValue()),
          }),
        ]
      : [
          columnHelper.accessor("linkCount", {
            header: ({ column }) => (
              <SortableHeader column={column} label="Linking pages" />
            ),
            cell: ({ getValue }) => dash(getValue()),
            meta: { cellClassName: "tabular-nums" },
          }),
        ]),
    columnHelper.accessor("authority", {
      header: ({ column }) => (
        <SortableHeader column={column} label="Authority" />
      ),
      cell: ({ getValue }) => dash(getValue()),
      meta: { cellClassName: "tabular-nums" },
    }),
  ];
}

function TregListTable({
  kind,
  snapshot,
}: {
  kind: TregListKind;
  snapshot: TregListSnapshot;
}) {
  const columns = useMemo(() => buildColumns(kind), [kind]);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[1]);
  const table = useDataTable({
    data: snapshot.rows,
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
    <DataTable
      table={table}
      empty={{
        title: "No rows in this snapshot",
        description: "Serpstat returned nothing for this domain.",
      }}
      toolbar={
        <DataTableToolbar>
          <span className="text-sm tabular-nums text-muted-foreground">
            Saved snapshot · {new Date(snapshot.fetchedAt).toLocaleString()} ·{" "}
            {snapshot.rows.length} shown
            {snapshot.total == null ? "" : ` of ${snapshot.total} reported`}
          </span>
        </DataTableToolbar>
      }
      footer={
        snapshot.rows.length > 0 ? (
          <TablePagination
            page={page + 1}
            pageSize={pageSize}
            pageSizes={PAGE_SIZES}
            totalCount={snapshot.rows.length}
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

function csvEscape(v: unknown): string {
  const string =
    v == null
      ? ""
      : typeof v === "string" || typeof v === "number" || typeof v === "boolean"
        ? String(v)
        : JSON.stringify(v);
  return '"' + string.replaceAll('"', '""') + '"';
}
function exportCsv(data: TregListSnapshot) {
  const header = [
    "Source",
    "Target",
    "Anchor",
    "Follow status",
    "First seen",
    "Authority",
    "Link count",
  ];
  const rows = data.rows.map((r) => [
    r.source,
    r.target,
    r.anchor,
    r.linkType,
    r.firstSeen,
    r.authority,
    r.linkCount,
  ]);
  const csv = [header, ...rows]
    .map((row) => row.map(csvEscape).join(","))
    .join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `treg-${data.kind}-${data.domain}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
export function TregSavedLists({
  projectId,
  target,
}: {
  projectId: string;
  target: string;
}) {
  const [kind, setKind] = useState<TregListKind>("domains");
  const [snapshot, setSnapshot] = useState<TregListSnapshot | null>(null);
  const domain = target.toLowerCase().trim();
  const valid =
    /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(domain);
  const mutation = useMutation({
    mutationFn: (fetchFresh: boolean) =>
      getTregSavedList({
        data: {
          projectId,
          domain,
          kind,
          fetchFresh,
          acknowledgeCost: fetchFresh,
        },
      }),
    onSuccess: (result) => setSnapshot(result),
  });
  useEffect(() => {
    setSnapshot(null);
    mutation.reset();
    if (valid) mutation.mutate(false);
    // Deliberately tied to the query domain and tab; no paid fetch on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain, kind, projectId]);
  const canShow = snapshot?.domain === domain && snapshot.kind === kind;
  return (
    <section className="rounded-xl border border-border bg-card p-4 space-y-3">
      <h2 className="font-semibold">treg · Saved Backlink Research</h2>
      <p className="text-sm text-muted-foreground">
        Browse referring domains and source backlinks, save the first 20 results
        per list to this project, and export CSV. Saved snapshots remain
        available without another paid call.
      </p>
      <div className="flex flex-wrap gap-2">
        {(["domains", "backlinks"] as const).map((k) => (
          <Button
            key={k}
            variant={kind === k ? "default" : "outline"}
            size="sm"
            onClick={() => setKind(k)}
          >
            {k === "domains" ? "Referring domains" : "Individual backlinks"}
          </Button>
        ))}
      </div>
      {!valid ? (
        <p className="text-sm text-muted-foreground">
          Search a bare domain first.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={mutation.isPending}
            onClick={() => mutation.mutate(true)}
          >
            {mutation.isPending
              ? "Loading…"
              : "Fetch & save first 20 (paid API)"}
          </Button>
          {canShow ? (
            <Button variant="outline" onClick={() => exportCsv(snapshot)}>
              Export CSV
            </Button>
          ) : null}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Estimated provider charge up to about $0.01 per request; actual billing
        may vary by rows. Requesting the same list again refreshes the saved
        snapshot and may incur another charge.
      </p>
      {mutation.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {mutation.error instanceof Error
            ? mutation.error.message
            : "Could not load list"}
        </p>
      ) : null}
      {canShow ? (
        <>
          <TregListTable kind={kind} snapshot={snapshot} />
        </>
      ) : !mutation.isPending && valid ? (
        <p className="text-sm text-muted-foreground">
          No saved snapshot yet. Click Fetch & save.
        </p>
      ) : null}
    </section>
  );
}
