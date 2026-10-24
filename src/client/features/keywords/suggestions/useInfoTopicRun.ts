import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { extractInfoTopicsBatch } from "@/serverFunctions/infoTopics";
import {
  saveSuggestionRun,
  updateSuggestionRun,
} from "@/serverFunctions/savedSuggestions";
import { INFO_TOPIC_BATCH, type InfoTopicRow } from "@/shared/infoTopics";
import { savedRunsQueryKey } from "./suggestionOptions";

export type InfoRunSettings = {
  locationCode: number;
  languageCode: string;
  acceptExisting: boolean;
  useAi: boolean;
};

type RunState = {
  runId: string;
  topics: string[];
  settings: InfoRunSettings;
  countryName: string;
};

/** Progress is saved to the run after every this many topics. */
const SAVE_EVERY = 100;

const runName = (topics: string[], countryName: string) =>
  `${topics.length.toLocaleString("en-US")} info topics · ${countryName}`;

/**
 * Runs Info topics in batches. The run is saved when it starts and after
 * every 100 topics, so a closed tab loses little and a saved run can resume
 * with only the topics it has not done yet.
 */
export function useInfoTopicRun(projectId: string) {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<InfoTopicRow[]>([]);
  const [progress, setProgress] = useState<null | {
    done: number;
    total: number;
  }>(null);
  const [error, setError] = useState("");
  const stopRequested = useRef(false);

  async function persist(run: RunState, done: InfoTopicRow[]) {
    await updateSuggestionRun({
      data: {
        projectId,
        runId: run.runId,
        name: runName(run.topics, run.countryName),
        result: {
          mode: "info",
          countryName: run.countryName,
          rows: done,
          topics: run.topics,
          settings: run.settings,
        },
      },
    });
    void queryClient.invalidateQueries({
      queryKey: savedRunsQueryKey(projectId),
    });
  }

  async function process(run: RunState, already: InfoTopicRow[]) {
    const finished = new Set(already.map((row) => row.topic));
    const remaining = run.topics.filter((topic) => !finished.has(topic));
    let done = already;
    let unsaved = 0;
    stopRequested.current = false;
    setError("");
    setRows(done);
    setProgress({ done: done.length, total: run.topics.length });
    let aiWarned = false;
    let saveWarned = false;
    try {
      for (let i = 0; i < remaining.length; i += INFO_TOPIC_BATCH) {
        if (stopRequested.current) break;
        const result = await extractInfoTopicsBatch({
          data: {
            projectId,
            topics: remaining.slice(i, i + INFO_TOPIC_BATCH),
            ...run.settings,
          },
        });
        if (!result.ok) {
          setError(result.error);
          break;
        }
        if (result.aiMissing && !aiWarned) {
          aiWarned = true;
          toast.info(
            "AI check skipped: add an OpenRouter key under Project Integrations to use it.",
          );
        }
        done = [...done, ...result.rows];
        unsaved += result.rows.length;
        setRows(done);
        setProgress({ done: done.length, total: run.topics.length });
        if (unsaved >= SAVE_EVERY) {
          // A failed save (e.g. the daily storage write limit) must not stop
          // the run; the next save or the final one tries again.
          await persist(run, done).then(
            () => {
              unsaved = 0;
            },
            () => {
              if (!saveWarned) {
                saveWarned = true;
                toast.warning(
                  "Progress could not be saved just now; the run continues and will try again.",
                );
              }
            },
          );
        }
      }
    } catch (cause) {
      setError(
        `${getStandardErrorMessage(cause, "Extraction failed.")} Progress is saved: open the run under Saved results and resume.`,
      );
    } finally {
      // Stopped, failed or finished: keep everything done so far.
      await persist(run, done).catch(() => undefined);
      setProgress(null);
    }
  }

  return {
    rows,
    progress,
    error,
    stop: () => {
      stopRequested.current = true;
    },
    /** A new run: saved first, so it can be resumed whatever happens. */
    start: async (input: Omit<RunState, "runId">) => {
      const meta = await saveSuggestionRun({
        data: {
          projectId,
          name: runName(input.topics, input.countryName),
          result: {
            mode: "info",
            countryName: input.countryName,
            rows: [],
            topics: input.topics,
            settings: input.settings,
          },
        },
      });
      await process({ ...input, runId: meta.id }, []);
    },
    /** Continue a saved run with the topics it has not done yet. */
    resume: (run: RunState, done: InfoTopicRow[]) => process(run, done),
  };
}
