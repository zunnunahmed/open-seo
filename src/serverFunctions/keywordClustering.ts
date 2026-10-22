import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  requireProjectContext,
  requireProjectSeoRoute,
} from "@/serverFunctions/middleware";
import { createDataforseoClient } from "@/server/lib/dataforseo/client";
import { advanceJob } from "@/server/custom/clustering/jobs";
import {
  activeSeoProviderRoute,
  runWithSeoProviderRoute,
} from "@/server/custom/providers/treg/dataforseoTransport";
import {
  createJob,
  deleteJob,
  getChunk,
  getJob,
  listJobs,
} from "@/server/custom/clustering/jobStore";
import {
  cleanKeywordList,
  MAX_CLUSTER_KEYWORDS,
  MAX_KEYWORD_LENGTH,
} from "@/shared/keywordClustering";

const projectRequest = z.object({ projectId: z.string().min(1) });
const jobRequest = projectRequest.extend({ jobId: z.string().uuid() });

export const listClusterJobs = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectRequest)
  .handler(async ({ context }) => listJobs(env.R2, context.projectId));

/** Free: stores the cleaned list and returns the cost estimate to confirm. */
export const createClusterJob = createServerFn({ method: "POST" })
  .middleware(requireProjectSeoRoute)
  .validator(
    projectRequest.extend({
      name: z.string().trim().max(120),
      keywords: z
        .array(
          z.object({
            keyword: z.string().max(MAX_KEYWORD_LENGTH * 4),
            volume: z.number().nonnegative().nullable(),
            cpc: z.number().nonnegative().nullable(),
          }),
        )
        .max(MAX_CLUSTER_KEYWORDS * 2),
      fetchVolume: z.boolean(),
      locationCode: z.number().int().positive(),
      languageCode: z.string().min(2).max(10),
    }),
  )
  .handler(async ({ data, context }) => {
    const { keywords } = cleanKeywordList(data.keywords);
    if (keywords.length < 2)
      return { ok: false as const, error: "Add at least 2 keywords." };
    if (keywords.length > MAX_CLUSTER_KEYWORDS)
      return {
        ok: false as const,
        error: `Up to ${MAX_CLUSTER_KEYWORDS.toLocaleString()} keywords per run (got ${keywords.length.toLocaleString()} after removing duplicates).`,
      };
    const job = await createJob(env.R2, context.projectId, {
      name:
        data.name ||
        `${keywords.length.toLocaleString()} keywords · ${new Date().toLocaleDateString("en-AU")}`,
      keywords,
      fetchVolume: data.fetchVolume,
      locationCode: data.locationCode,
      languageCode: data.languageCode,
      route: activeSeoProviderRoute(),
    });
    return { ok: true as const, job };
  });

/** One bounded step; `start` confirms the estimated spend for a draft. */
export const advanceClusterJob = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(jobRequest.extend({ start: z.boolean().optional() }))
  .handler(async ({ data, context }) => {
    // A job keeps the route it was estimated on, even if the project's
    // provider setting changes while it runs.
    const route =
      (await getJob(env.R2, context.projectId, data.jobId))?.route ??
      "direct_dataforseo";
    return runWithSeoProviderRoute(route, () =>
      advanceJob(
        env.R2,
        context.projectId,
        data.jobId,
        createDataforseoClient(context, route),
        { start: data.start },
      ),
    );
  });

export const getClusterJob = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(jobRequest)
  .handler(
    async ({ data, context }) =>
      (await getJob(env.R2, context.projectId, data.jobId)) ?? null,
  );

/** Keywords and SERPs for one chunk of up to 100 keywords. */
export const getClusterJobChunk = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(jobRequest.extend({ index: z.number().int().min(0).max(100) }))
  .handler(async ({ data, context }) => {
    const chunk = await getChunk(
      env.R2,
      context.projectId,
      data.jobId,
      data.index,
    );
    if (!chunk) return [];
    return chunk.keywords.map((k) => ({
      ...k,
      serp: chunk.serps[k.keyword] ?? null,
      error: chunk.failed[k.keyword] ?? null,
    }));
  });

export const deleteClusterJob = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(jobRequest)
  .handler(async ({ data, context }) => {
    await deleteJob(env.R2, context.projectId, data.jobId);
    return { ok: true as const };
  });
