import type { createDataforseoClient } from "@/server/lib/dataforseo/client";
import { fetchKeywordMetricsForList } from "@/server/lib/dataforseo/keyword-metrics";
import {
  CLUSTER_SERP_DEPTH,
  extractClusterSerp,
  fetchClusterSerpTaskResult,
} from "@/server/custom/clustering/dataforseo";
import { DataforseoChargedTaskError } from "@/server/lib/dataforseo/envelope";
import {
  chunkKey,
  getChunk,
  metaKey,
  metaSchema,
  readJson,
  updateIndex,
  writeJson,
  type Bucket,
} from "@/server/custom/clustering/jobStore";

/**
 * Keyword clustering runs as a resumable job the browser advances one small
 * step at a time, so each request stays inside the Workers free plan limits
 * (≈50 outgoing requests, short CPU).
 */
const VOLUME_CHUNKS_PER_STEP = 7; // 700 keywords = one metrics request
const POST_CHUNKS_PER_STEP = 3;
const COLLECT_PER_STEP = 20;
const COLLECT_CONCURRENCY = 5;
// treg routes fetch SERPs live, one outgoing request each.
const LIVE_PER_STEP = 25;
const LOCK_MS = 60_000;
// Queued tasks normally finish in minutes; give up on stragglers after a day.
const TASK_TIMEOUT_MS = 24 * 60 * 60 * 1000;

// Only the calls a job makes, so tests can fake them.
type DataforseoClient = Parameters<typeof fetchKeywordMetricsForList>[0] & {
  serp: Pick<
    ReturnType<typeof createDataforseoClient>["serp"],
    "clusterTaskPost" | "live"
  >;
};
type ClusterChunk = NonNullable<Awaited<ReturnType<typeof getChunk>>>;
type ClusterJobMeta = ReturnType<typeof metaSchema.parse>;

type StepResult = {
  job: ClusterJobMeta;
  phase: "volume" | "posting" | "collecting" | "done" | "busy";
  /** Results collected this step; 0 while DataForSEO is still working. */
  collected: number;
};

async function stepVolume(
  bucket: Bucket,
  projectId: string,
  meta: ClusterJobMeta,
  client: DataforseoClient,
) {
  const first = meta.volumeChunksDone;
  const last = Math.min(meta.chunkCount, first + VOLUME_CHUNKS_PER_STEP);
  const chunks: ClusterChunk[] = [];
  for (let n = first; n < last; n++) {
    const chunk = await getChunk(bucket, projectId, meta.id, n);
    if (chunk) chunks.push(chunk);
  }
  const missing = chunks.flatMap((c) =>
    c.keywords.filter((k) => k.volume == null).map((k) => k.keyword),
  );
  if (missing.length) {
    const rows = await fetchKeywordMetricsForList(client, {
      keywords: missing,
      locationCode: meta.locationCode,
      languageCode: meta.languageCode,
      creditFeature: "keyword_research",
    });
    const byKeyword = new Map(rows.map((r) => [r.keyword.toLowerCase(), r]));
    for (const chunk of chunks)
      for (const k of chunk.keywords) {
        const row = byKeyword.get(k.keyword);
        if (k.volume == null && row) {
          k.volume = row.searchVolume;
          k.cpc = k.cpc ?? row.cpc;
        }
      }
  }
  for (let i = 0; i < chunks.length; i++)
    await writeJson(bucket, chunkKey(projectId, meta.id, first + i), chunks[i]);
  meta.volumeChunksDone = last;
}

async function stepPost(
  bucket: Bucket,
  projectId: string,
  meta: ClusterJobMeta,
  client: DataforseoClient,
) {
  const first = meta.postedChunks;
  const last = Math.min(meta.chunkCount, first + POST_CHUNKS_PER_STEP);
  for (let n = first; n < last; n++) {
    const chunk = await getChunk(bucket, projectId, meta.id, n);
    if (!chunk) continue;
    const posted = await client.serp.clusterTaskPost({
      tasks: chunk.keywords.map((k, i) => ({
        keyword: k.keyword,
        tag: `${i}`,
      })),
      locationCode: meta.locationCode,
      languageCode: meta.languageCode,
    });
    for (const task of posted) {
      const keyword = chunk.keywords[Number(task.tag)]?.keyword;
      if (keyword) chunk.tasks[keyword] = task.taskId;
    }
    let rejected = 0;
    for (const k of chunk.keywords)
      if (!chunk.tasks[k.keyword]) {
        chunk.failed[k.keyword] = "Not accepted by DataForSEO";
        rejected++;
      }
    // Persist task ids before anything else can fail, so a retry never
    // re-posts (and re-charges) this chunk.
    await writeJson(bucket, chunkKey(projectId, meta.id, n), chunk);
    meta.failed += rejected;
    meta.postedChunks = n + 1;
    meta.postedAt ??= new Date().toISOString();
  }
}

/**
 * treg routes have no SERP queue: fetch top-10 SERPs live, a few per step,
 * and store each result immediately so nothing is fetched (or billed) twice.
 */
async function stepLive(
  bucket: Bucket,
  projectId: string,
  meta: ClusterJobMeta,
  client: DataforseoClient,
) {
  let budget = LIVE_PER_STEP;
  while (budget > 0 && meta.postedChunks < meta.chunkCount) {
    const n = meta.postedChunks;
    const chunk = await getChunk(bucket, projectId, meta.id, n);
    if (!chunk) {
      meta.postedChunks = n + 1;
      continue;
    }
    const todo = chunk.keywords
      .map((k) => k.keyword)
      .filter((k) => !chunk.serps[k] && !chunk.failed[k]);
    const batch = todo.slice(0, budget);
    budget -= batch.length;
    let done = 0;
    let failed = 0;
    let firstError: unknown = null;
    const queue = [...batch];
    const worker = async () => {
      while (queue.length) {
        const keyword = queue.shift();
        if (!keyword) return;
        try {
          const items = await client.serp.live({
            keyword,
            locationCode: meta.locationCode,
            languageCode: meta.languageCode,
            depth: CLUSTER_SERP_DEPTH,
            creditFeature: "keyword_research",
          });
          chunk.serps[keyword] = extractClusterSerp(items);
          done++;
        } catch (error) {
          // A rejected task is final for that keyword; anything else (auth,
          // balance, outage) leaves it pending for a later step.
          if (error instanceof DataforseoChargedTaskError) {
            chunk.failed[keyword] = error.message;
            failed++;
          } else firstError ??= error;
        }
      }
    };
    await Promise.all(Array.from({ length: COLLECT_CONCURRENCY }, worker));
    await writeJson(bucket, chunkKey(projectId, meta.id, n), chunk);
    meta.completed += done;
    meta.failed += failed;
    meta.postedAt ??= new Date().toISOString();
    if (firstError && done === 0 && failed === 0) throw firstError;
    if (batch.length === todo.length && !firstError) meta.postedChunks = n + 1;
    else break;
  }
}

function pendingKeywords(chunk: ClusterChunk): string[] {
  return Object.keys(chunk.tasks).filter(
    (k) => !chunk.serps[k] && !chunk.failed[k],
  );
}

async function stepCollect(
  bucket: Bucket,
  projectId: string,
  meta: ClusterJobMeta,
  fetchResult: typeof fetchClusterSerpTaskResult,
): Promise<number> {
  const timedOut =
    meta.postedAt != null &&
    Date.now() - Date.parse(meta.postedAt) > TASK_TIMEOUT_MS;
  let budget = COLLECT_PER_STEP;
  let collected = 0;
  for (let n = 0; n < meta.chunkCount && budget > 0; n++) {
    const chunk = await getChunk(bucket, projectId, meta.id, n);
    if (!chunk) continue;
    const pending = pendingKeywords(chunk);
    if (pending.length === 0) continue;
    const batch = pending.slice(0, budget);
    budget -= batch.length;
    let done = 0;
    let failed = 0;
    let firstError: unknown = null;
    if (timedOut) {
      for (const k of batch) chunk.failed[k] = "Timed out at DataForSEO";
      failed = batch.length;
    } else {
      const queue = [...batch];
      const worker = async () => {
        while (queue.length) {
          const keyword = queue.shift();
          if (!keyword) return;
          try {
            const outcome = await fetchResult(chunk.tasks[keyword]);
            if (outcome.status === "completed") {
              chunk.serps[keyword] = outcome.serp;
              done++;
            } else if (outcome.status === "failed") {
              chunk.failed[keyword] = outcome.message;
              failed++;
            }
          } catch (error) {
            // Leave it pending; it is retried on a later step.
            firstError ??= error;
          }
        }
      };
      await Promise.all(Array.from({ length: COLLECT_CONCURRENCY }, worker));
    }
    await writeJson(bucket, chunkKey(projectId, meta.id, n), chunk);
    meta.completed += done;
    meta.failed += failed;
    collected += done;
    // Every request erroring (auth, outage) must surface, not poll forever.
    if (firstError && done === 0 && failed === 0) throw firstError;
    // Results arrive roughly in post order: wait for this chunk before
    // polling later ones.
    if (collected === 0) break;
  }
  return collected;
}

/**
 * Advance a job by one bounded step. A lease on the meta object (R2
 * conditional write) stops two tabs from posting the same chunk twice.
 */
export async function advanceJob(
  bucket: Bucket,
  projectId: string,
  id: string,
  client: DataforseoClient,
  options: { start?: boolean } = {},
): Promise<StepResult> {
  const record = await readJson(bucket, metaKey(projectId, id), metaSchema);
  if (!record) throw new Error("Clustering job not found");
  const meta = record.value;
  if (meta.status === "done") return { job: meta, phase: "done", collected: 0 };
  if (meta.status === "draft" && !options.start)
    return { job: meta, phase: "busy", collected: 0 };
  if (meta.lockUntil > Date.now())
    return { job: meta, phase: "busy", collected: 0 };

  meta.status = "running";
  meta.lockUntil = Date.now() + LOCK_MS;
  const leased = await bucket.put(
    metaKey(projectId, id),
    JSON.stringify(meta),
    { onlyIf: { etagMatches: record.etag } },
  );
  if (!leased) return { job: meta, phase: "busy", collected: 0 };

  let phase: StepResult["phase"];
  let collected = 0;
  try {
    if (meta.volumeChunksDone < meta.chunkCount) {
      phase = "volume";
      await stepVolume(bucket, projectId, meta, client);
    } else if (meta.postedChunks < meta.chunkCount) {
      phase = "posting";
      if (meta.route === "direct_dataforseo")
        await stepPost(bucket, projectId, meta, client);
      else await stepLive(bucket, projectId, meta, client);
    } else {
      phase = "collecting";
      collected = await stepCollect(
        bucket,
        projectId,
        meta,
        fetchClusterSerpTaskResult,
      );
      if (meta.completed + meta.failed >= meta.total) {
        meta.status = "done";
        phase = "done";
      }
    }
  } finally {
    meta.lockUntil = 0;
    await writeJson(bucket, metaKey(projectId, id), meta);
    await updateIndex(bucket, projectId, (jobs) =>
      jobs.map((job) => (job.id === id ? meta : job)),
    );
  }
  return { job: meta, phase, collected };
}
