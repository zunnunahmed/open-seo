import { PageHeader } from "@/client/components/PageHeader";
import { Button } from "@/client/components/ui/button";
import { DataSourceLabel } from "@/client/features/integrations/DataSourceLabel";
import { SavedRunView, SavedSuggestionRuns } from "./SavedSuggestionRuns";

export type SuggestionMode = "free" | "dataforseo" | "info";

const MODES: Array<{ value: SuggestionMode; label: string }> = [
  { value: "free", label: "Free autocomplete" },
  { value: "dataforseo", label: "Paid + volume" },
  { value: "info", label: "Info topics" },
];

export function SuggestionModeButtons({
  mode,
  onSwitch,
}: {
  mode: SuggestionMode;
  onSwitch: (next: SuggestionMode) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {MODES.map((entry) => (
        <Button
          key={entry.value}
          variant={mode === entry.value ? "default" : "outline"}
          size="sm"
          onClick={() => onSwitch(entry.value)}
        >
          {entry.label}
        </Button>
      ))}
    </div>
  );
}

export function SuggestionsHeader({ projectId }: { projectId: string }) {
  return (
    <PageHeader
      title="Search Suggestions"
      actions={<DataSourceLabel projectId={projectId} prefix="Paid lookups" />}
      description="Mine autocomplete before and after your seed for free, pay per lookup for Google suggestions with search volume, or turn topics into the keywords people search."
    />
  );
}

/** The saved-runs list and, when one is open, its results. */
export function SavedRunsSection({
  projectId,
  openRunId,
  onOpen,
}: {
  projectId: string;
  openRunId: string | null;
  onOpen: (runId: string | null) => void;
}) {
  return (
    <>
      <SavedSuggestionRuns
        projectId={projectId}
        openRunId={openRunId}
        onOpen={onOpen}
      />
      {openRunId ? (
        <SavedRunView
          projectId={projectId}
          runId={openRunId}
          onClose={() => onOpen(null)}
        />
      ) : null}
    </>
  );
}
