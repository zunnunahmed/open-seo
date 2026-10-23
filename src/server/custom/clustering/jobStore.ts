import { z } from "zod";
import { dataforseoPricing } from "@/server/lib/dataforseo/pricing";
import type { ClusterInputKeyword } from "@/shared/keywordClustering";
import { getKeywordDataProvider } from "@/shared/keyword-locations";
import { CLUSTER_SERP_DEPTH } from "@/server/custom/clustering/dataforseo";
import type { SeoProviderRoute } from "@/server/custom/providers/treg/dataforseoTransport";
import {
  SERPSTAT_KEYWORD_USD,
  SERPSTAT_SERP_USD,
} from "@/server/custom/providers/treg/serpstatAsDataforseo";

/**
 * R2 storage for keyword clustering jobs (strongly consistent, high write
 * limits): one meta object plus one object per 100 keywords, and a per-project
 * index of recent runs.
 */
const CHUNK_SIZE = 100;
const MAX_JOBS = 20;

const chunkSchema = z.object({
  keywords: z.array(
    z.object({
      keyword: z.string(),
      volume: z.number().nullable(),
      cpc: z.number().nullable(),
    }),
  ),
  tasks: z.record(z.string(), z.string()),
  serps: z.record(
    z.string(),
    z.object({ urls: z.array(z.string()), features: z.array(z.string()) }),
  ),
  failed: z.record(z.string(), z.string()),
});
type ClusterChunk = z.infer<typeof chunkSchema>;

export const clusterSettingsSchema = z.object({
  threshold: z.number().int().min(1).max(10),
  mode: z.enum(["soft", "strict", "balanced"]),
  primaryBy: z.enum(["volume", "cpc"]),
  competitors: z.string().max(1000),
  ignorePlatforms: z.boolean(),
  weightTop: z.boolean(),
});

export const metaSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  locationCode: z.number(),
  languageCode: z.string(),
  total: z.number(),
  chunkCount: z.number(),
  fetchVolume: z.boolean(),
  status: z.enum(["draft", "running", "done"]),
  volumeChunksDone: z.number(),
  postedChunks: z.number(),
  postedAt: z.string().nullable(),
  completed: z.number(),
  failed: z.number(),
  estimatedUsd: z.object({ serps: z.number(), volume: z.number() }),
  lockUntil: z.number(),
  // The project's provider route when the job was created; the estimate the
  // user confirmed depends on it. Jobs from before routes were direct.
  route: z
    .enum(["direct_dataforseo", "treg_serpstat", "treg_dataforseo"])
    .default("direct_dataforseo"),
  // City, county or region for local SERPs; null searches the whole country.
  locationName: z.string().nullable().default(null),
  // The user's clustering settings, saved so a reopened run looks the same.
  settings: clusterSettingsSchema.nullable().default(null),
});

/** Save a run's clustering settings (meta and the run list). */
export async function saveJobSettings(
  bucket: Bucket,
  projectId: string,
  id: string,
  settings: z.infer<typeof clusterSettingsSchema>,
) {
  const record = await readJson(bucket, metaKey(projectId, id), metaSchema);
  if (!record) return null;
  const meta = { ...record.value, settings };
  await writeJson(bucket, metaKey(projectId, id), meta);
  await updateIndex(bucket, projectId, (jobs) =>
    jobs.map((job) => (job.id === id ? meta : job)),
  );
  return meta;
}
type ClusterJobMeta = z.infer<typeof metaSchema>;
const indexSchema = z.array(metaSchema);

/** The R2 operations used (Env["R2"] satisfies it). */
export type Bucket = {
  get(key: string): Promise<{ text(): Promise<string>; etag: string } | null>;
  put(
    key: string,
    value: string,
    options?: {
      httpMetadata?: { contentType: string };
      onlyIf?: { etagMatches: string };
    },
  ): Promise<unknown>;
  delete(keys: string | string[]): Promise<void>;
};

const base = (projectId: string) => `custom/keyword-clusters/${projectId}`;
export const metaKey = (p: string, id: string) => `${base(p)}/${id}/meta.json`;
export const chunkKey = (p: string, id: string, n: number) =>
  `${base(p)}/${id}/chunk-${n}.json`;
const indexKey = (p: string) => `${base(p)}/index.json`;

export async function readJson<T>(
  bucket: Bucket,
  key: string,
  schema: z.ZodType<T>,
): Promise<{ value: T; etag: string } | null> {
  const object = await bucket.get(key);
  if (!object) return null;
  return {
    value: schema.parse(JSON.parse(await object.text()) as unknown),
    etag: object.etag,
  };
}

export const writeJson = (bucket: Bucket, key: string, value: unknown) =>
  bucket.put(key, JSON.stringify(value), {
    httpMetadata: { contentType: "application/json" },
  });

export async function listJobs(
  bucket: Bucket,
  projectId: string,
): Promise<ClusterJobMeta[]> {
  return (
    (await readJson(bucket, indexKey(projectId), indexSchema))?.value ?? []
  );
}

export async function updateIndex(
  bucket: Bucket,
  projectId: string,
  update: (jobs: ClusterJobMeta[]) => ClusterJobMeta[],
) {
  const jobs = await listJobs(bucket, projectId);
  await writeJson(bucket, indexKey(projectId), update(jobs));
}

export async function getJob(bucket: Bucket, projectId: string, id: string) {
  return (await readJson(bucket, metaKey(projectId, id), metaSchema))?.value;
}

export async function getChunk(
  bucket: Bucket,
  projectId: string,
  id: string,
  n: number,
): Promise<ClusterChunk | null> {
  return (
    (await readJson(bucket, chunkKey(projectId, id, n), chunkSchema))?.value ??
    null
  );
}

/** Upper-bound USD for SERPs and (for keywords without volume) metrics. */
export function estimateJobUsd(
  keywords: ClusterInputKeyword[],
  fetchVolume: boolean,
  locationCode: number,
  languageCode: string,
  route: SeoProviderRoute = "direct_dataforseo",
) {
  let serps = 0;
  if (route === "direct_dataforseo") {
    for (let i = 0; i < keywords.length; i += CHUNK_SIZE) {
      serps += dataforseoPricing.serp.clusterTaskPost({
        tasks: keywords
          .slice(i, i + CHUNK_SIZE)
          .map((k, j) => ({ keyword: k.keyword, tag: String(i + j) })),
        locationCode,
        languageCode,
      });
    }
  } else if (route === "treg_serpstat") {
    serps = keywords.length * SERPSTAT_SERP_USD;
  } else {
    // treg has no queued SERP endpoint, so treg routes fetch each SERP live.
    for (const k of keywords)
      serps += dataforseoPricing.serp.live({
        keyword: k.keyword,
        locationCode,
        languageCode,
        depth: CLUSTER_SERP_DEPTH,
      });
  }
  const missing = fetchVolume
    ? keywords.filter((k) => k.volume == null).length
    : 0;
  if (route === "treg_serpstat")
    return { serps, volume: missing * SERPSTAT_KEYWORD_USD };
  const useAds = getKeywordDataProvider(locationCode) === "google_ads";
  let volume = 0;
  for (let i = 0; i < missing; i += 700) {
    const batch = {
      keywords: Array.from({ length: Math.min(700, missing - i) }, () => ""),
      locationCode,
      languageCode,
    };
    volume += useAds
      ? dataforseoPricing.keywords.adsSearchVolume(batch)
      : dataforseoPricing.labs.keywordOverview(batch);
  }
  return { serps, volume };
}

export async function createJob(
  bucket: Bucket,
  projectId: string,
  input: {
    name: string;
    keywords: ClusterInputKeyword[];
    fetchVolume: boolean;
    locationCode: number;
    languageCode: string;
    locationName?: string | null;
    route: SeoProviderRoute;
  },
): Promise<ClusterJobMeta> {
  const id = crypto.randomUUID();
  const chunkCount = Math.ceil(input.keywords.length / CHUNK_SIZE);
  for (let n = 0; n < chunkCount; n++) {
    const chunk: ClusterChunk = {
      keywords: input.keywords.slice(n * CHUNK_SIZE, (n + 1) * CHUNK_SIZE),
      tasks: {},
      serps: {},
      failed: {},
    };
    await writeJson(bucket, chunkKey(projectId, id, n), chunk);
  }
  const needsVolume =
    input.fetchVolume && input.keywords.some((k) => k.volume == null);
  const meta: ClusterJobMeta = {
    id,
    name: input.name,
    createdAt: new Date().toISOString(),
    locationCode: input.locationCode,
    languageCode: input.languageCode,
    total: input.keywords.length,
    chunkCount,
    fetchVolume: needsVolume,
    status: "draft",
    volumeChunksDone: needsVolume ? 0 : chunkCount,
    postedChunks: 0,
    postedAt: null,
    completed: 0,
    failed: 0,
    estimatedUsd: estimateJobUsd(
      input.keywords,
      needsVolume,
      input.locationCode,
      input.languageCode,
      input.route,
    ),
    lockUntil: 0,
    route: input.route,
    locationName: input.locationName ?? null,
    settings: null,
  };
  await writeJson(bucket, metaKey(projectId, id), meta);
  let removed: ClusterJobMeta[] = [];
  await updateIndex(bucket, projectId, (jobs) => {
    const next = [meta, ...jobs];
    removed = next.slice(MAX_JOBS);
    return next.slice(0, MAX_JOBS);
  });
  for (const old of removed) await deleteJobObjects(bucket, projectId, old);
  return meta;
}

async function deleteJobObjects(
  bucket: Bucket,
  projectId: string,
  meta: ClusterJobMeta,
) {
  const keys = [metaKey(projectId, meta.id)];
  for (let n = 0; n < meta.chunkCount; n++)
    keys.push(chunkKey(projectId, meta.id, n));
  await bucket.delete(keys);
}

export async function deleteJob(bucket: Bucket, projectId: string, id: string) {
  const meta = await getJob(bucket, projectId, id);
  if (meta) await deleteJobObjects(bucket, projectId, meta);
  await updateIndex(bucket, projectId, (jobs) =>
    jobs.filter((job) => job.id !== id),
  );
}
