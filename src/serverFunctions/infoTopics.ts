import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireProjectSeoRoute } from "@/serverFunctions/middleware";
import { createDataforseoClient } from "@/server/lib/dataforseo/client";
import { activeSeoProviderRoute } from "@/server/custom/providers/treg/dataforseoTransport";
import { extractInfoTopics } from "@/server/custom/infoTopics/extractInfoTopics";
import { infoTopicAi } from "@/server/custom/infoTopics/aiPick";
import { INFO_TOPIC_BATCH } from "@/shared/infoTopics";

/**
 * Suggestions → Info topics: one batch of topics per request, so a run of
 * hundreds stays inside Workers Free limits; the page sends batches in turn.
 */
export const extractInfoTopicsBatch = createServerFn({ method: "POST" })
  .middleware(requireProjectSeoRoute)
  .validator(
    z.object({
      projectId: z.string().min(1),
      topics: z
        .array(z.string().trim().min(2).max(120))
        .min(1)
        .max(INFO_TOPIC_BATCH),
      locationCode: z.number().int().positive().optional(),
      languageCode: z.string().min(2).max(10).optional(),
      acceptExisting: z.boolean(),
      useAi: z.boolean(),
    }),
  )
  .handler(async ({ data, context }) => {
    if (activeSeoProviderRoute() === "treg_serpstat")
      return {
        ok: false as const,
        error:
          "Serpstat has no keyword data for a single page. Switch this project to a DataForSEO route in Project Integrations to use Info topics.",
      };
    const ai = data.useAi ? await infoTopicAi(context.projectId) : null;
    const rows = await extractInfoTopics({
      client: createDataforseoClient(context),
      kv: env.KV,
      topics: data.topics,
      market: {
        locationCode: data.locationCode ?? context.project.locationCode,
        languageCode: data.languageCode ?? context.project.languageCode,
      },
      acceptExisting: data.acceptExisting,
      ai,
    });
    return { ok: true as const, rows, aiMissing: data.useAi && !ai };
  });
