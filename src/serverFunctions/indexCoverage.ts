import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireProjectContext } from "@/serverFunctions/middleware";
import { GscConnectionRepository } from "@/server/features/gsc/repositories/GscConnectionRepository";
import {
  createProjectInspector,
  DAILY_LIMIT,
  inspectBatch,
  readResults,
  readState,
  readUrls,
  summarizeCoverage,
  TICK_LIMIT,
} from "@/server/custom/sitemaps/indexCoverage";

const request = z.object({ projectId: z.string().min(1) });

export const getIndexCoverage = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(request)
  .handler(async ({ context }) => {
    const [connection, urls, results, state] = await Promise.all([
      GscConnectionRepository.getByProjectId(context.projectId),
      readUrls(env.KV, context.projectId),
      readResults(env.KV, context.projectId),
      readState(env.KV, context.projectId, new Date()),
    ]);
    return {
      gscSiteUrl: connection?.siteUrl ?? null,
      ...summarizeCoverage(urls, results),
      usedToday: state.used,
      dailyLimit: DAILY_LIMIT,
      lastRunAt: state.lastRunAt,
      lastError: state.lastError,
    };
  });

/** Inspect one small batch now (counts toward the daily limit). */
export const checkIndexCoverageNow = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(request)
  .handler(async ({ context }) => {
    const inspect = await createProjectInspector(context.projectId);
    if (!inspect)
      return {
        ok: false as const,
        error: "Connect Google Search Console in Integrations first.",
      };
    const outcome = await inspectBatch(
      env.KV,
      context.projectId,
      TICK_LIMIT,
      inspect,
    );
    if (outcome.error) return { ok: false as const, error: outcome.error };
    if (outcome.inspected === 0)
      return {
        ok: false as const,
        error:
          "Nothing to check: run a sitemap check first, or today's limit is reached, or all URLs were checked in the last 7 days.",
      };
    return { ok: true as const, inspected: outcome.inspected };
  });

export const listIndexCoverageRows = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(request)
  .handler(async ({ context }) => {
    const [urls, results] = await Promise.all([
      readUrls(env.KV, context.projectId),
      readResults(env.KV, context.projectId),
    ]);
    return urls.map((url) => {
      const entry = results[url];
      return {
        url,
        status: !entry
          ? "Not checked"
          : entry.i === true
            ? "Indexed"
            : entry.i === false
              ? "Not indexed"
              : "Check failed",
        reason: entry?.r ?? "",
        lastCrawl: entry?.c ?? "",
        checkedAt: entry?.t ?? "",
      };
    });
  });
