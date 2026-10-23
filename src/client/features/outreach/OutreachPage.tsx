import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  createColumnHelper,
  type RowSelectionState,
  type SortingState,
} from "@tanstack/react-table";
import { toast } from "sonner";
import { PageHeader } from "@/client/components/PageHeader";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { SortableHeader } from "@/client/components/table/SortableHeader";
import {
  DataTable,
  makeSelectionColumn,
  useDataTable,
  useSelectionAnchor,
} from "@/client/components/table/DataTable";
import { DataTableToolbar } from "@/client/components/table/DataTableToolbar";
import { TablePagination } from "@/client/components/table/TablePagination";
import {
  findOutreachContacts,
  getOutreach,
  removeOutreachProspects,
  suppressOutreach,
  updateOutreachStatus,
} from "@/serverFunctions/outreach";
import { OutreachFinders } from "./OutreachFinders";
import { OutreachSendCard } from "./OutreachSendCard";
import { ContactList } from "./OutreachContactList";
import {
  applyOutreachFilters,
  EMPTY_FILTERS,
  OutreachFilters,
  tldOptions,
} from "./OutreachFilters";

type Outreach = Awaited<ReturnType<typeof getOutreach>>;
type Contact = Outreach["contacts"][number];
type Prospect = Outreach["prospects"][number] & { contacts: Contact[] };

const SOURCE_LABEL: Record<Prospect["source"], string> = {
  link_gap: "Link gap",
  guest_post: "Guest post",
  pr: "PR",
  import: "Import",
  backlinks: "Backlinks",
};

const PAGE_SIZES = [25, 50, 100] as const;
// Each prospect costs up to ~11 treg calls; 3 per request fits Workers Free.
const CONTACT_BATCH = 3;

const columnHelper = createColumnHelper<Prospect>();

function buildColumns(anchor: ReturnType<typeof useSelectionAnchor>) {
  return [
    makeSelectionColumn<Prospect>(
      anchor,
      (row) => `Select ${row.original.domain}`,
    ),
    columnHelper.accessor("domain", {
      header: ({ column }) => (
        <SortableHeader column={column} label="Website" />
      ),
      cell: ({ row }) => (
        <div className="space-y-0.5">
          <a
            className="font-medium hover:underline"
            href={`https://${row.original.domain}`}
            target="_blank"
            rel="noreferrer noopener"
            onClick={(event) => event.stopPropagation()}
          >
            {row.original.domain}
          </a>
          {row.original.sourceUrl ? (
            <a
              className="block max-w-[360px] truncate text-xs text-muted-foreground hover:underline"
              href={row.original.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              title={row.original.sourceTitle ?? row.original.sourceUrl}
              onClick={(event) => event.stopPropagation()}
            >
              {row.original.sourceTitle ?? row.original.sourceUrl}
            </a>
          ) : null}
        </div>
      ),
    }),
    columnHelper.accessor("source", {
      header: ({ column }) => <SortableHeader column={column} label="Source" />,
      cell: ({ row }) => (
        <div className="space-y-0.5 text-xs">
          <Badge variant="outline" size="sm">
            {SOURCE_LABEL[row.original.source]}
          </Badge>
          {row.original.sourceDetail ? (
            <div className="max-w-[200px] truncate text-muted-foreground">
              {row.original.sourceDetail}
            </div>
          ) : null}
        </div>
      ),
    }),
    columnHelper.accessor("authority", {
      header: ({ column }) => (
        <SortableHeader column={column} label="Authority" align="right" />
      ),
      cell: ({ getValue }) => getValue() ?? "—",
      meta: { cellClassName: "text-right tabular-nums" },
    }),
    columnHelper.accessor((prospect) => prospect.contacts.length, {
      id: "contacts",
      header: ({ column }) => (
        <SortableHeader column={column} label="Contacts" align="right" />
      ),
      cell: ({ row }) => {
        const valid = row.original.contacts.filter(
          (contact) => contact.verification === "valid",
        ).length;
        return row.original.contacts.length === 0
          ? "—"
          : `${valid} valid / ${row.original.contacts.length}`;
      },
      meta: { cellClassName: "text-right tabular-nums whitespace-nowrap" },
    }),
    columnHelper.accessor("status", {
      header: ({ column }) => <SortableHeader column={column} label="Status" />,
      cell: ({ getValue }) => (
        <Badge variant="secondary" size="sm">
          {getValue().replace("_", " ")}
        </Badge>
      ),
    }),
  ];
}

/**
 * Outreach → Link Prospects: find link-gap, guest-post and PR prospects,
 * find and verify their emails through treg (cheapest first, paid only on a
 * hit), and add verified contacts to an Instantly.ai campaign.
 */
export function OutreachPage({ projectId }: { projectId: string }) {
  const query = useQuery({
    queryKey: ["outreach", projectId],
    queryFn: () => getOutreach({ data: { projectId } }),
  });
  const prospects = useMemo<Prospect[]>(() => {
    const byProspect = new Map<string, Contact[]>();
    for (const contact of query.data?.contacts ?? []) {
      const list = byProspect.get(contact.prospectId) ?? [];
      list.push(contact);
      byProspect.set(contact.prospectId, list);
    }
    return (query.data?.prospects ?? []).map((prospect) => ({
      ...prospect,
      contacts: byProspect.get(prospect.id) ?? [],
    }));
  }, [query.data]);

  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const visible = useMemo(
    () => applyOutreachFilters(prospects, filters),
    [prospects, filters],
  );
  const anchor = useSelectionAnchor();
  const columns = useMemo(() => buildColumns(anchor), [anchor]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [sorting, setSorting] = useState<SortingState>([]);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[1]);
  const [finding, setFinding] = useState<null | {
    done: number;
    total: number;
  }>(null);
  const stopFinding = useRef(false);

  const table = useDataTable({
    data: visible,
    columns,
    withSorting: true,
    withExpanded: true,
    withPagination: true,
    autoResetPageIndex: false,
    getRowId: (prospect) => prospect.id,
    state: { rowSelection, sorting, pagination: { pageIndex: page, pageSize } },
    onRowSelectionChange: setRowSelection,
    onSortingChange: (updater) => {
      setSorting(updater);
      setPage(0);
    },
  });

  const selected = visible.filter((prospect) => rowSelection[prospect.id]);
  const unsentContactIds = selected.flatMap((prospect) =>
    prospect.contacts
      .filter((contact) => !contact.sentAt)
      .map((contact) => contact.id),
  );
  const refresh = () => void query.refetch();

  async function findEmails() {
    const targets = selected.filter((prospect) => !prospect.contactsCheckedAt);
    if (targets.length === 0) {
      toast.info("The selected prospects were already checked for emails.");
      return;
    }
    stopFinding.current = false;
    setFinding({ done: 0, total: targets.length });
    let found = 0;
    let costUsd = 0;
    try {
      for (let i = 0; i < targets.length; i += CONTACT_BATCH) {
        if (stopFinding.current) break;
        const result = await findOutreachContacts({
          data: {
            projectId,
            prospectIds: targets.slice(i, i + CONTACT_BATCH).map((p) => p.id),
          },
        });
        if (!result.ok) {
          toast.error(result.error, { duration: 15_000 });
          return;
        }
        found += result.found;
        costUsd += result.costUsd;
        setFinding({
          done: Math.min(targets.length, i + CONTACT_BATCH),
          total: targets.length,
        });
        refresh();
      }
      toast.success(
        `${found} emails found and verified (about US$${costUsd.toFixed(3)} in treg charges).`,
      );
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Finding emails failed.",
      );
    } finally {
      setFinding(null);
    }
  }

  async function setStatus(status: "replied" | "won" | "skipped" | "new") {
    await updateOutreachStatus({
      data: { projectId, prospectIds: selected.map((p) => p.id), status },
    });
    refresh();
  }

  async function remove() {
    await removeOutreachProspects({
      data: { projectId, prospectIds: selected.map((p) => p.id) },
    });
    setRowSelection({});
    toast.success(`Removed ${selected.length} from Link Prospects.`);
    refresh();
  }

  async function doNotContact() {
    await suppressOutreach({
      data: {
        projectId,
        values: selected.map((p) => p.domain),
        prospectIds: selected.map((p) => p.id),
      },
    });
    setRowSelection({});
    toast.success("Added to the do-not-contact list and removed.");
    refresh();
  }

  const unchecked = selected.filter((p) => !p.contactsCheckedAt).length;
  return (
    <div className="px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-4">
        <PageHeader
          title="Link Prospects"
          description="Find link-building and PR prospects, get verified emails through treg, and send them to your Instantly.ai campaigns."
        />
        <OutreachFinders projectId={projectId} onAdded={refresh} />
        <DataTable
          table={table}
          isLoading={query.isPending}
          empty={{
            title: "No prospects yet",
            description:
              "Use step 1 to find link-gap, guest-post or PR prospects.",
          }}
          onRowClick={(row) => row.toggleExpanded()}
          renderExpandedRow={(row) => (
            <ContactList contacts={row.original.contacts} />
          )}
          toolbar={
            <>
              <DataTableToolbar
                actions={
                  selected.length > 0 ? (
                    <>
                      <Button
                        size="sm"
                        disabled={finding !== null || unchecked === 0}
                        title="Cheapest first: about US$0.005 per email found, misses free"
                        onClick={() => void findEmails()}
                      >
                        {finding
                          ? `Finding emails… ${finding.done}/${finding.total}`
                          : `Find emails (${unchecked}, paid)`}
                      </Button>
                      {finding ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            stopFinding.current = true;
                          }}
                        >
                          Stop
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void setStatus("replied")}
                      >
                        Replied
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void setStatus("won")}
                      >
                        Link won
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void setStatus("skipped")}
                      >
                        Skip
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void remove()}
                      >
                        Remove
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void doNotContact()}
                      >
                        Do not contact
                      </Button>
                    </>
                  ) : null
                }
              >
                <span className="font-semibold">2. Prospects</span>
                <span className="text-sm tabular-nums text-muted-foreground">
                  {visible.length === prospects.length
                    ? `${prospects.length.toLocaleString()} prospects`
                    : `${visible.length.toLocaleString()} of ${prospects.length.toLocaleString()} prospects`}
                  {selected.length ? ` · ${selected.length} selected` : ""} ·
                  click a row for its contacts
                </span>
              </DataTableToolbar>
              <OutreachFilters
                value={filters}
                onChange={(next) => {
                  setFilters(next);
                  setPage(0);
                  setRowSelection({});
                }}
                tlds={tldOptions(prospects)}
              />
            </>
          }
          footer={
            prospects.length > 0 ? (
              <TablePagination
                page={page + 1}
                pageSize={pageSize}
                pageSizes={PAGE_SIZES}
                totalCount={visible.length}
                onPageChange={(next) => setPage(next - 1)}
                onPageSizeChange={(size) => {
                  setPageSize(size);
                  setPage(0);
                }}
              />
            ) : undefined
          }
        />
        <OutreachSendCard
          projectId={projectId}
          contactIds={unsentContactIds}
          onSent={refresh}
        />
      </div>
    </div>
  );
}
