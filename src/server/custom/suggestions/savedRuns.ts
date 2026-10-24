import { z } from "zod";

/**
 * Search Suggestions results the user chose to keep. Each run is one KV value
 * written with a 28-day expirationTtl, so Cloudflare deletes it on its own;
 * a per-project index lists the runs and drops entries past their expiry.
 */
const SAVED_RUN_DAYS = 28;
const TTL_SECONDS = SAVED_RUN_DAYS * 24 * 60 * 60;
const MAX_RUNS = 50;
const MAX_ROWS = 5000;

/** The KV operations used (Env["KV"] satisfies it). */
export type SavedRunsKv = {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<unknown>;
  delete(key: string): Promise<unknown>;
};

const placement = z.enum(["before", "after"]);

const freeRunSchema = z.object({
  mode: z.literal("free"),
  countryName: z.string().max(100),
  queriesRun: z.number().int().nonnegative(),
  rows: z
    .array(
      z.object({
        keyword: z.string().max(500),
        placement,
        modifier: z.string().max(100),
        seed: z.string().max(200),
        query: z.string().max(500),
      }),
    )
    .max(MAX_ROWS),
});

const paidRunSchema = z.object({
  mode: z.literal("paid"),
  sourceLabel: z.string().max(100),
  metricsError: z.string().max(1000).nullable(),
  rows: z
    .array(
      z.object({
        keyword: z.string().max(500),
        placement,
        modifier: z.string().max(100),
        seed: z.string().max(200),
        searchVolume: z.number().nullable(),
        cpc: z.number().nullable(),
        competition: z.number().nullable(),
        keywordDifficulty: z.number().nullable(),
        intent: z.enum([
          "informational",
          "commercial",
          "transactional",
          "navigational",
          "unknown",
        ]),
      }),
    )
    .max(MAX_ROWS),
});

const infoRunSchema = z.object({
  mode: z.literal("info"),
  countryName: z.string().max(100),
  rows: z
    .array(
      z.object({
        topic: z.string().max(200),
        infoTopic: z.string().max(500).nullable(),
        volume: z.number().nullable(),
        difficulty: z.number().nullable(),
        cpc: z.number().nullable(),
        intent: z.string().max(40).nullable(),
        matchedBy: z.enum(["existing", "word", "ai"]).nullable(),
        urlRank: z.number().int().nullable(),
        url: z.string().max(2048).nullable(),
        position: z.number().nullable(),
        aiOverview: z.boolean().nullable(),
      }),
    )
    .max(MAX_ROWS),
  /** Every topic of the run, so an unfinished run can be resumed. */
  topics: z.array(z.string().max(200)).max(MAX_ROWS).default([]),
  settings: z
    .object({
      locationCode: z.number().int(),
      languageCode: z.string().max(10),
      acceptExisting: z.boolean(),
      useAi: z.boolean(),
    })
    .nullable()
    .default(null),
});

export const savedRunInputSchema = z.object({
  name: z.string().trim().min(1).max(160),
  result: z.discriminatedUnion("mode", [
    freeRunSchema,
    paidRunSchema,
    infoRunSchema,
  ]),
});
type SavedRunInput = z.infer<typeof savedRunInputSchema>;

const metaSchema = z.object({
  id: z.string(),
  name: z.string(),
  mode: z.enum(["free", "paid", "info"]),
  keywordCount: z.number(),
  savedAt: z.string(),
  expiresAt: z.string(),
});
type SavedRunMeta = z.infer<typeof metaSchema>;

const runSchema = savedRunInputSchema.extend({ meta: metaSchema });

const indexKey = (projectId: string) =>
  `custom:suggestions:index:v1:${projectId}`;
const runKey = (projectId: string, id: string) =>
  `custom:suggestions:run:v1:${projectId}:${id}`;

async function readIndex(
  kv: SavedRunsKv,
  projectId: string,
  now: Date,
): Promise<SavedRunMeta[]> {
  const raw = await kv.get(indexKey(projectId));
  const parsed = z
    .array(metaSchema)
    .safeParse(raw ? (JSON.parse(raw) as unknown) : []);
  return (parsed.success ? parsed.data : []).filter(
    (meta) => Date.parse(meta.expiresAt) > now.getTime(),
  );
}

async function writeIndex(
  kv: SavedRunsKv,
  projectId: string,
  runs: SavedRunMeta[],
) {
  // The index lives as long as its newest run.
  await kv.put(indexKey(projectId), JSON.stringify(runs), {
    expirationTtl: TTL_SECONDS,
  });
}

export async function listSavedRuns(
  kv: SavedRunsKv,
  projectId: string,
  now = new Date(),
): Promise<SavedRunMeta[]> {
  return readIndex(kv, projectId, now);
}

export async function saveRun(
  kv: SavedRunsKv,
  projectId: string,
  input: SavedRunInput,
  now = new Date(),
): Promise<SavedRunMeta> {
  const meta: SavedRunMeta = {
    id: crypto.randomUUID(),
    name: input.name,
    mode: input.result.mode,
    keywordCount: input.result.rows.length,
    savedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + TTL_SECONDS * 1000).toISOString(),
  };
  await kv.put(runKey(projectId, meta.id), JSON.stringify({ ...input, meta }), {
    expirationTtl: TTL_SECONDS,
  });
  const runs = [meta, ...(await readIndex(kv, projectId, now))];
  for (const dropped of runs.slice(MAX_RUNS))
    await kv.delete(runKey(projectId, dropped.id));
  await writeIndex(kv, projectId, runs.slice(0, MAX_RUNS));
  return meta;
}

/** Replace a saved run's results (an Info topics run saving its progress). */
export async function updateRun(
  kv: SavedRunsKv,
  projectId: string,
  id: string,
  input: SavedRunInput,
  now = new Date(),
): Promise<SavedRunMeta | null> {
  const existing = await getSavedRun(kv, projectId, id);
  if (!existing) return null;
  const meta: SavedRunMeta = {
    ...existing.meta,
    name: input.name,
    keywordCount: input.result.rows.length,
    expiresAt: new Date(now.getTime() + TTL_SECONDS * 1000).toISOString(),
  };
  await kv.put(runKey(projectId, id), JSON.stringify({ ...input, meta }), {
    expirationTtl: TTL_SECONDS,
  });
  const runs = await readIndex(kv, projectId, now);
  await writeIndex(
    kv,
    projectId,
    runs.map((run) => (run.id === id ? meta : run)),
  );
  return meta;
}

export async function getSavedRun(
  kv: SavedRunsKv,
  projectId: string,
  id: string,
) {
  const raw = await kv.get(runKey(projectId, id));
  if (!raw) return null;
  const parsed = runSchema.safeParse(JSON.parse(raw) as unknown);
  return parsed.success ? parsed.data : null;
}

export async function deleteSavedRun(
  kv: SavedRunsKv,
  projectId: string,
  id: string,
  now = new Date(),
) {
  await kv.delete(runKey(projectId, id));
  const runs = await readIndex(kv, projectId, now);
  await writeIndex(
    kv,
    projectId,
    runs.filter((run) => run.id !== id),
  );
}
