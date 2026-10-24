import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireProjectContext } from "@/serverFunctions/middleware";
import {
  deleteSavedRun,
  getSavedRun,
  listSavedRuns,
  savedRunInputSchema,
  saveRun,
  updateRun,
} from "@/server/custom/suggestions/savedRuns";

const projectRequest = z.object({ projectId: z.string().min(1) });
const runRequest = projectRequest.extend({ runId: z.string().uuid() });

export const listSavedSuggestionRuns = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectRequest)
  .handler(async ({ context }) => listSavedRuns(env.KV, context.projectId));

export const saveSuggestionRun = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectRequest.merge(savedRunInputSchema))
  .handler(async ({ data, context }) =>
    saveRun(env.KV, context.projectId, {
      name: data.name,
      result: data.result,
    }),
  );

/** Save a running Info topics run's progress over its earlier save. */
export const updateSuggestionRun = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(runRequest.merge(savedRunInputSchema))
  .handler(async ({ data, context }) =>
    updateRun(env.KV, context.projectId, data.runId, {
      name: data.name,
      result: data.result,
    }),
  );

export const getSavedSuggestionRun = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(runRequest)
  .handler(async ({ data, context }) =>
    getSavedRun(env.KV, context.projectId, data.runId),
  );

export const deleteSavedSuggestionRun = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(runRequest)
  .handler(async ({ data, context }) => {
    await deleteSavedRun(env.KV, context.projectId, data.runId);
    return { ok: true as const };
  });
