import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CardShell } from "@/client/components/CardShell";
import { Button } from "@/client/components/ui/button";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { DataSourceLabel } from "@/client/features/integrations/DataSourceLabel";
import {
  advanceClusterJob,
  getClusterJob,
  getClusterJobChunk,
} from "@/serverFunctions/keywordClustering";
import type { ClusterableKeyword } from "@/shared/keywordClustering";
import { ClusterResults } from "./ClusterResults";

type Job = NonNullable<Awaited<ReturnType<typeof getClusterJob>>>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const usd = (value: number) =>
  `$${value < 1 ? value.toFixed(3) : value.toFixed(2)}`;

function progressOf(job: Job) {
  if (job.volumeChunksDone < job.chunkCount)
    return {
      label: "Looking up search volume",
      value: job.volumeChunksDone / job.chunkCount,
    };
  if (job.postedChunks < job.chunkCount)
    return job.route === "direct_dataforseo"
      ? {
          label: "Sending keywords to DataForSEO",
          value: job.postedChunks / job.chunkCount,
        }
      : {
          label: "Fetching Google results through treg",
          value: (job.completed + job.failed) / job.total,
        };
  return {
    label: "Collecting Google results",
    value: (job.completed + job.failed) / job.total,
  };
}

export function ClusterRunView({
  projectId,
  jobId,
  ownDomain,
}: {
  projectId: string;
  jobId: string;
  ownDomain: string | null;
}) {
  const client = useQueryClient();
  const queryKey = ["clusterJob", projectId, jobId];
  const jobQuery = useQuery({
    queryKey,
    queryFn: () => getClusterJob({ data: { projectId, jobId } }),
  });
  const job = jobQuery.data;
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [waiting, setWaiting] = useState(false);
  const cancelled = useRef(false);
  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, [jobId]);

  const run = useCallback(
    async (start: boolean) => {
      setRunning(true);
      setError(null);
      let confirm = start;
      try {
        while (!cancelled.current) {
          const step = await advanceClusterJob({
            data: { projectId, jobId, ...(confirm ? { start: true } : {}) },
          });
          confirm = false;
          client.setQueryData(["clusterJob", projectId, jobId], step.job);
          if (step.phase === "done") break;
          const idle =
            step.phase === "busy" ||
            (step.phase === "collecting" && step.collected === 0);
          setWaiting(idle);
          if (idle) await sleep(step.phase === "busy" ? 5_000 : 15_000);
        }
      } catch (err) {
        setError(err);
      } finally {
        setRunning(false);
        setWaiting(false);
        void client.invalidateQueries({
          queryKey: ["clusterJobs", projectId],
        });
      }
    },
    [client, projectId, jobId],
  );

  // Resume a confirmed run when its page is opened again.
  const autoResumed = useRef(false);
  useEffect(() => {
    if (job?.status === "running" && !running && !autoResumed.current) {
      autoResumed.current = true;
      void run(false);
    }
  }, [job?.status, running, run]);

  const results = useQuery({
    queryKey: ["clusterJobResults", projectId, jobId],
    enabled: job?.status === "done",
    staleTime: Infinity,
    queryFn: async () => {
      if (!job) return { items: [], failed: [] };
      const indexes = Array.from({ length: job.chunkCount }, (_, i) => i);
      const rows: Awaited<ReturnType<typeof getClusterJobChunk>> = [];
      const queue = [...indexes];
      await Promise.all(
        Array.from({ length: 6 }, async () => {
          while (queue.length) {
            const index = queue.shift();
            if (index === undefined) return;
            rows.push(
              ...(await getClusterJobChunk({
                data: { projectId, jobId, index },
              })),
            );
          }
        }),
      );
      const items: ClusterableKeyword[] = [];
      const failed: Array<{ keyword: string; error: string }> = [];
      for (const row of rows) {
        if (row.serp)
          items.push({
            keyword: row.keyword,
            volume: row.volume,
            cpc: row.cpc,
            ...row.serp,
          });
        else
          failed.push({
            keyword: row.keyword,
            error: row.error ?? "No result",
          });
      }
      return { items, failed };
    },
  });

  if (jobQuery.isPending)
    return <p className="text-sm text-muted-foreground">Loading run…</p>;
  if (!job)
    return (
      <p className="text-sm text-destructive">This run no longer exists.</p>
    );

  if (job.status === "draft") {
    const total = job.estimatedUsd.serps + job.estimatedUsd.volume;
    return (
      <CardShell
        title={job.name}
        action={<DataSourceLabel projectId={projectId} route={job.route} />}
      >
        <div className="space-y-3 text-sm">
          <p>
            {job.total.toLocaleString()} keywords
            {job.locationName ? ` in ${job.locationName}` : ""}. Estimated{" "}
            {job.route === "direct_dataforseo" ? "DataForSEO" : "treg"} cost:{" "}
            <strong>{usd(total)}</strong> (top-10 Google results{" "}
            {usd(job.estimatedUsd.serps)}
            {job.estimatedUsd.volume
              ? `, search volume ${usd(job.estimatedUsd.volume)}`
              : ""}
            ). This is an upper bound.
          </p>
          <p className="text-muted-foreground">
            {job.route === "direct_dataforseo"
              ? "Results use DataForSEO’s standard queue and usually take 5–30 minutes."
              : job.route === "treg_serpstat"
                ? "This project uses Serpstat through treg: country-level desktop results, fetched a few at a time."
                : "This project routes through treg, which has no SERP queue, so each result is fetched live at the higher live price."}{" "}
            Keep this tab open; if you leave, reopen the run to continue.
          </p>
          <Button disabled={running} onClick={() => void run(true)}>
            Start clustering ({usd(total)})
          </Button>
        </div>
      </CardShell>
    );
  }

  if (job.status === "running") {
    const progress = progressOf(job);
    return (
      <CardShell
        title={job.name}
        action={<DataSourceLabel projectId={projectId} route={job.route} />}
      >
        <div className="space-y-3 text-sm">
          <p>
            {progress.label}… {Math.round(progress.value * 100)}%
          </p>
          <div className="h-2 rounded bg-muted">
            <div
              className="h-2 rounded bg-primary transition-all"
              style={{ width: `${Math.max(2, progress.value * 100)}%` }}
            />
          </div>
          <p className="text-muted-foreground">
            {job.completed.toLocaleString()} of {job.total.toLocaleString()}{" "}
            keywords have results
            {job.failed ? ` · ${job.failed.toLocaleString()} failed` : ""}
            {waiting ? " · waiting for DataForSEO…" : ""}
          </p>
          {error ? (
            <div className="space-y-2">
              <p role="alert" className="text-destructive">
                {getStandardErrorMessage(error)}
              </p>
              <Button variant="outline" onClick={() => void run(false)}>
                Resume
              </Button>
            </div>
          ) : !running ? (
            <Button variant="outline" onClick={() => void run(false)}>
              Resume
            </Button>
          ) : null}
        </div>
      </CardShell>
    );
  }

  if (results.isPending)
    return <p className="text-sm text-muted-foreground">Loading results…</p>;
  if (results.isError)
    return (
      <p className="text-sm text-destructive">
        {getStandardErrorMessage(results.error)}
      </p>
    );
  return (
    <div className="space-y-3">
      <DataSourceLabel projectId={projectId} route={job.route} />
      <ClusterResults
        projectId={projectId}
        jobId={jobId}
        savedSettings={job.settings}
        name={job.name}
        items={results.data.items}
        failed={results.data.failed}
        ownDomain={ownDomain}
      />
    </div>
  );
}
