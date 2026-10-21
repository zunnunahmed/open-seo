import { sort } from "remeda";
import { z } from "zod";
import { dataforseoGet, dataforseoPost } from "@/server/lib/dataforseo/core";
import {
  failedResponseError,
  isNoResultsTask,
  isTaskInProgress,
  type DataforseoApiResponse,
  type DataforseoTaskLike,
} from "@/server/lib/dataforseo/envelope";
import { MAX_TASKS_PER_POST } from "@/server/lib/dataforseo/shared";
import { AppError } from "@/server/lib/errors";
import { normalizeSerpUrl, type ClusterSerp } from "@/shared/keywordClustering";

/** SERP clustering compares the top 10 organic results (one billed page). */
export const CLUSTER_SERP_DEPTH = 10;

type ClusterSerpTaskInput = { keyword: string; tag: string };
type PostedClusterSerpTask = { tag: string; taskId: string };

/**
 * Post queued (standard priority) top-10 SERP tasks. Charged at post time;
 * collection through fetchClusterSerpTaskResult is free.
 */
export async function postClusterSerpTasks(input: {
  tasks: ClusterSerpTaskInput[];
  locationCode: number;
  languageCode: string;
}): Promise<DataforseoApiResponse<PostedClusterSerpTask[]>> {
  if (input.tasks.length === 0 || input.tasks.length > MAX_TASKS_PER_POST) {
    throw new AppError(
      "INTERNAL_ERROR",
      `task_post accepts 1-${MAX_TASKS_PER_POST} tasks, got ${input.tasks.length}`,
    );
  }
  const response = await dataforseoPost<
    DataforseoTaskLike & { id?: string; data?: Record<string, unknown> }
  >(
    "/v3/serp/google/organic/task_post",
    input.tasks.map((task) => ({
      keyword: task.keyword,
      location_code: input.locationCode,
      language_code: input.languageCode,
      device: "desktop",
      os: "windows",
      depth: CLUSTER_SERP_DEPTH,
      tag: task.tag,
    })),
  );
  if (!response || response.status_code !== 20000) {
    throw failedResponseError(response, "DataForSEO task_post failed");
  }
  const posted: PostedClusterSerpTask[] = [];
  let costUsd = 0;
  for (const entry of response.tasks ?? []) {
    costUsd += entry.cost ?? 0;
    const tag: unknown = entry.data?.tag;
    if (entry.status_code !== 20100 || !entry.id || typeof tag !== "string") {
      console.warn(
        `dataforseo.cluster_task_post.rejected-entry (${entry.status_code}): ${entry.status_message}`,
      );
      continue;
    }
    posted.push({ tag, taskId: entry.id });
  }
  return {
    data: posted,
    billing: {
      path: ["v3", "serp", "google", "organic", "task_post"],
      costUsd,
    },
  };
}

const serpItemSchema = z.object({
  type: z.string(),
  rank_group: z.number().nullish(),
  url: z.string().nullish(),
});

/** Top-10 organic URLs and the SERP feature types present on the page. */
export function extractClusterSerp(items: unknown): ClusterSerp {
  const list: unknown[] = Array.isArray(items) ? items : [];
  const organic: Array<{ rank: number; url: string }> = [];
  const features = new Set<string>();
  for (const raw of list) {
    const parsed = serpItemSchema.safeParse(raw);
    if (!parsed.success) continue;
    const item = parsed.data;
    if (item.type !== "organic") {
      features.add(item.type);
      continue;
    }
    const url = item.url ? normalizeSerpUrl(item.url) : null;
    if (!url) continue;
    organic.push({ rank: item.rank_group ?? 999, url });
  }
  const urls: string[] = [];
  for (const entry of sort(organic, (a, b) => a.rank - b.rank)) {
    if (!urls.includes(entry.url)) urls.push(entry.url);
    if (urls.length === CLUSTER_SERP_DEPTH) break;
  }
  return { urls, features: sort([...features], (a, b) => a.localeCompare(b)) };
}

type ClusterSerpTaskOutcome =
  | { status: "pending" }
  | { status: "failed"; message: string }
  | { status: "completed"; serp: ClusterSerp };

/** Collect one queued task. Free at DataForSEO, so deliberately unmetered. */
export async function fetchClusterSerpTaskResult(
  taskId: string,
): Promise<ClusterSerpTaskOutcome> {
  const response = await dataforseoGet(
    `/v3/serp/google/organic/task_get/advanced/${encodeURIComponent(taskId)}`,
  );
  const task = response?.tasks?.[0];
  if (!response || response.status_code !== 20000 || !task) {
    throw failedResponseError(response, "DataForSEO task_get failed");
  }
  if (isTaskInProgress(task)) return { status: "pending" };
  if (task.status_code !== 20000) {
    if (isNoResultsTask(task))
      return { status: "completed", serp: { urls: [], features: [] } };
    return {
      status: "failed",
      message:
        task.status_message || `DataForSEO task failed (${task.status_code})`,
    };
  }
  const first: unknown = task.result?.[0];
  const items =
    first && typeof first === "object" && "items" in first ? first.items : [];
  return { status: "completed", serp: extractClusterSerp(items) };
}
