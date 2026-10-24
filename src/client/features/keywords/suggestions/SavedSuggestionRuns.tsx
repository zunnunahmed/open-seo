import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import { toast } from "sonner";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { DataTable, useDataTable } from "@/client/components/table/DataTable";
import { DataTableToolbar } from "@/client/components/table/DataTableToolbar";
import { ErrorState } from "@/client/components/ErrorState";
import {
  deleteSavedSuggestionRun,
  getSavedSuggestionRun,
  listSavedSuggestionRuns,
  saveSuggestionRun,
} from "@/serverFunctions/savedSuggestions";
import { SuggestionsDfsResults } from "./SuggestionsDfsResults";
import { SuggestionsFreeResults } from "./SuggestionsFreeResults";
import { InfoTopicRunView } from "./InfoTopicRunView";
import { savedRunsQueryKey } from "./suggestionOptions";

type SavedRun = Awaited<ReturnType<typeof listSavedSuggestionRuns>>[number];

const columnHelper = createColumnHelper<SavedRun>();

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

type SavedRunResult = Parameters<typeof saveSuggestionRun>[0]["data"]["result"];

/** Saves the shown results under a name; they delete themselves in 28 days. */
export function useSaveSuggestionRun(projectId: string) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (input: { name: string; result: SavedRunResult }) =>
      saveSuggestionRun({ data: { projectId, ...input } }),
    onSuccess: (meta) => {
      void queryClient.invalidateQueries({
        queryKey: savedRunsQueryKey(projectId),
      });
      toast.success(
        `Results saved. They are deleted automatically on ${formatDate(meta.expiresAt)}.`,
      );
    },
    onError: () => toast.error("Could not save the results"),
  });
  return {
    isPending: mutation.isPending,
    mutate: (name: string, result: SavedRunResult) =>
      mutation.mutate({ name, result }),
  };
}

/** One saved run, shown in the same tables as a fresh run. */
export function SavedRunView({
  projectId,
  runId,
  onClose,
}: {
  projectId: string;
  runId: string;
  onClose: () => void;
}) {
  const query = useQuery({
    queryKey: ["saved-suggestion-run", projectId, runId],
    queryFn: () => getSavedSuggestionRun({ data: { projectId, runId } }),
  });
  const close = (
    <Button variant="outline" size="sm" onClick={onClose}>
      Close
    </Button>
  );
  if (query.isPending)
    return (
      <p className="text-sm text-muted-foreground">Loading saved results…</p>
    );
  if (!query.data)
    return (
      <ErrorState
        variant="card"
        title="Saved results unavailable"
        message="They may have passed their 28 days and been deleted."
        action={close}
      />
    );
  const { meta, result } = query.data;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>
          Saved results:{" "}
          <strong className="text-foreground">{meta.name}</strong> · saved{" "}
          {formatDate(meta.savedAt)} · deleted automatically on{" "}
          {formatDate(meta.expiresAt)}
        </span>
        {close}
      </div>
      {result.mode === "free" ? (
        <SuggestionsFreeResults
          rows={result.rows}
          queriesRun={result.queriesRun}
          countryName={result.countryName}
        />
      ) : result.mode === "info" ? (
        <InfoTopicRunView
          key={runId}
          projectId={projectId}
          runId={runId}
          result={result}
        />
      ) : (
        <SuggestionsDfsResults
          rows={result.rows}
          metricsError={result.metricsError}
          sourceLabel={result.sourceLabel}
        />
      )}
    </div>
  );
}

/** Saved Search Suggestions results; each deletes itself after 28 days. */
export function SavedSuggestionRuns({
  projectId,
  openRunId,
  onOpen,
}: {
  projectId: string;
  openRunId: string | null;
  onOpen: (runId: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: savedRunsQueryKey(projectId),
    queryFn: () => listSavedSuggestionRuns({ data: { projectId } }),
  });
  const remove = useMutation({
    mutationFn: (runId: string) =>
      deleteSavedSuggestionRun({ data: { projectId, runId } }),
    onSuccess: (_, runId) => {
      if (runId === openRunId) onOpen(null);
      void queryClient.invalidateQueries({
        queryKey: savedRunsQueryKey(projectId),
      });
      toast.success("Saved results deleted");
    },
    onError: () => toast.error("Could not delete the saved results"),
  });

  const columns = useMemo(
    () => [
      columnHelper.accessor("name", {
        header: "Name",
        cell: ({ getValue }) => (
          <span className="font-medium">{getValue()}</span>
        ),
      }),
      columnHelper.accessor("mode", {
        header: "Type",
        cell: ({ getValue }) =>
          getValue() === "info" ? (
            <Badge variant="info" size="sm">
              Info topics
            </Badge>
          ) : getValue() === "paid" ? (
            <Badge variant="soft" size="sm">
              Paid + volume
            </Badge>
          ) : (
            <Badge variant="secondary" size="sm">
              Free
            </Badge>
          ),
      }),
      columnHelper.accessor("keywordCount", {
        header: "Keywords",
        cell: ({ getValue }) => getValue().toLocaleString(),
        meta: { cellClassName: "tabular-nums" },
      }),
      columnHelper.accessor("savedAt", {
        header: "Saved",
        cell: ({ getValue }) => formatDate(getValue()),
        meta: { cellClassName: "whitespace-nowrap" },
      }),
      columnHelper.accessor("expiresAt", {
        header: "Deletes automatically",
        cell: ({ getValue }) => formatDate(getValue()),
        meta: { cellClassName: "whitespace-nowrap text-muted-foreground" },
      }),
      columnHelper.display({
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => (
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant={row.original.id === openRunId ? "default" : "outline"}
              onClick={() => onOpen(row.original.id)}
            >
              {row.original.id === openRunId ? "Viewing" : "View"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={remove.isPending}
              onClick={() => remove.mutate(row.original.id)}
            >
              Delete
            </Button>
          </div>
        ),
      }),
    ],
    [openRunId, onOpen, remove],
  );
  const table = useDataTable({
    data: query.data ?? [],
    columns,
    getRowId: (run) => run.id,
  });

  if (!query.data?.length) return null;
  return (
    <DataTable
      table={table}
      activeRowId={openRunId ?? undefined}
      empty={{ title: "No saved results" }}
      toolbar={
        <DataTableToolbar>
          <span className="text-sm font-medium">Saved results</span>
          <span className="text-sm text-muted-foreground">
            Each is deleted automatically 28 days after saving.
          </span>
        </DataTableToolbar>
      }
    />
  );
}
