import { z } from "zod";
import { GscConnectionRepository } from "@/server/features/gsc/repositories/GscConnectionRepository";
import { createGscClient } from "@/server/lib/gscClient";
import {
  DAILY_LIMIT,
  inspectBatch,
  readState,
  TICK_LIMIT,
  type Inspect,
} from "./indexCoverageStore";

const CONFIG_PREFIX = "custom:sitemaps:config:";
const ERROR_BACKOFF_MS = 6 * 60 * 60 * 1000;
const configSchema = z.object({
  enabled: z.boolean(),
  indexCoverage: z.boolean().optional(),
});

/** Inspector bound to the project's connected Search Console property. */
export async function createProjectInspector(
  projectId: string,
): Promise<Inspect | null> {
  const connection = await GscConnectionRepository.getByProjectId(projectId);
  if (!connection) return null;
  const client = createGscClient({
    userId: connection.connectedByUserId,
    gscAccountId: connection.gscAccountId ?? undefined,
  });
  return (url) => client.inspectUrl(connection.siteUrl, url);
}

/** Runs on the 5-minute cron. At most TICK_LIMIT inspections per run in total. */
export async function runScheduledIndexCoverage(kv: Env["KV"]): Promise<void> {
  let budget = TICK_LIMIT;
  let cursor: string | undefined;
  do {
    const page = await kv.list({
      prefix: CONFIG_PREFIX,
      limit: 100,
      ...(cursor ? { cursor } : {}),
    });
    for (const item of page.keys) {
      if (budget <= 0) return;
      const projectId = item.name.slice(CONFIG_PREFIX.length);
      try {
        const raw = await kv.get(item.name);
        if (!raw) continue;
        const config = configSchema.parse(JSON.parse(raw) as unknown);
        if (config.indexCoverage === false) continue;
        const now = new Date();
        const state = await readState(kv, projectId, now);
        if (state.used >= DAILY_LIMIT) continue;
        // Back off after a connection-level error instead of retrying every tick.
        if (
          state.lastError &&
          state.lastRunAt &&
          now.getTime() - Date.parse(state.lastRunAt) < ERROR_BACKOFF_MS
        )
          continue;
        const inspect = await createProjectInspector(projectId);
        if (!inspect) continue;
        const outcome = await inspectBatch(kv, projectId, budget, inspect);
        budget -= outcome.inspected;
        if (outcome.rateLimited) return;
      } catch (err) {
        console.error("[index-coverage] batch failed", projectId, err);
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
}
