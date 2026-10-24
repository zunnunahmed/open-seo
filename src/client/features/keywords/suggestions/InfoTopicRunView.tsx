import { Button } from "@/client/components/ui/button";
import type { InfoTopicRow } from "@/shared/infoTopics";
import { InfoTopicsResults } from "./InfoTopicsResults";
import { useInfoTopicRun, type InfoRunSettings } from "./useInfoTopicRun";

/** A saved Info topics run; an unfinished one can resume where it stopped. */
export function InfoTopicRunView({
  projectId,
  runId,
  result,
}: {
  projectId: string;
  runId: string;
  result: {
    countryName: string;
    rows: InfoTopicRow[];
    topics: string[];
    settings: InfoRunSettings | null;
  };
}) {
  const run = useInfoTopicRun(projectId);
  const resumed = run.progress !== null || run.rows.length > 0;
  const rows = resumed ? run.rows : result.rows;
  const left = result.topics.length - rows.length;
  const settings = result.settings;
  return (
    <div className="space-y-3">
      {left > 0 && settings ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 p-3 text-sm">
          <span>
            {rows.length.toLocaleString("en-US")} of{" "}
            {result.topics.length.toLocaleString("en-US")} topics done. Resuming
            runs only the {left.toLocaleString("en-US")} left; finished topics
            are not paid for again.
          </span>
          {run.progress ? (
            <>
              <span className="tabular-nums">
                Extracting… {run.progress.done}/{run.progress.total}
              </span>
              <Button size="sm" variant="ghost" onClick={run.stop}>
                Stop
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              onClick={() =>
                void run.resume(
                  {
                    runId,
                    topics: result.topics,
                    settings,
                    countryName: result.countryName,
                  },
                  rows,
                )
              }
            >
              Resume ({left.toLocaleString("en-US")} left)
            </Button>
          )}
        </div>
      ) : null}
      {run.error ? (
        <p role="alert" className="text-sm text-destructive">
          {run.error}
        </p>
      ) : null}
      <InfoTopicsResults rows={rows} countryName={result.countryName} />
    </div>
  );
}
