import { env } from "cloudflare:workers";
import { z } from "zod";
import { createServerFn } from "@tanstack/react-start";
import { requireProjectContext } from "@/serverFunctions/middleware";
import { getBacklinksProviderPreference } from "@/server/custom/providers/projectPreference";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";
import { fetchTregBacklinksSummary, fetchTregRoutedSummary } from "@/server/custom/providers/treg/client";

const schema = z.object({
  projectId: z.string().min(1),
  domain: z.string().min(4).max(253),
  acknowledgeCost: z.literal(true),
});
const summarySchema = z.object({
  provider: z.enum(["serpstat-via-treg", "treg-dataforseo"]),
  target: z.string(),
  backlinks: z.number().nullable(),
  referringDomains: z.number().nullable(),
  authority: z.number().nullable(),
  fetchedAt: z.string(),
  estimatedCostUsd: z.number(),
});
const DAILY_LIMIT = 25;
const TTL_SECONDS = 24 * 60 * 60;

export const runTregBacklinksSummary = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(schema)
  .handler(async ({ data, context }) => {
    const route = await getBacklinksProviderPreference(context.projectId);
    if (route !== "treg_serpstat" && route !== "treg_dataforseo") {
      throw new Error("A treg route is not selected for this project.");
    }
    if ((await getOptionalEnvValue("CUSTOM_TREG_ENABLED")) !== "true") {
      throw new Error("treg research is not enabled on this deployment.");
    }
    const token = await getOptionalEnvValue("TREG_API_TOKEN");
    if (!token) throw new Error("treg API token is not configured.");
    const domain = data.domain.toLowerCase().trim();
    if (
      !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(
        domain,
      )
    ) {
      throw new Error("Enter a bare domain (example.com), not a URL.");
    }

    // Project-separated 24-hour cache, namespaced per route so switching the
    // data source never shows the previous provider's numbers. A re-check
    // does not incur another charge.
    const key = `custom:treg:v1:${context.projectId}:${domain}:${route}`;
    const cached = await env.KV.get(key);
    if (cached) {
      return {
        ...summarySchema.parse(JSON.parse(cached) as unknown),
        cached: true,
      };
    }
    // Best-effort daily guard; KV counters are not atomic across concurrent
    // requests. Paid call is always an explicit button press, never automatic.
    const dayKey = `custom:treg:daily:${context.projectId}:${new Date().toISOString().slice(0, 10)}`;
    const used = Number((await env.KV.get(dayKey)) ?? 0);
    if (used >= DAILY_LIMIT) {
      throw new Error(
        "Daily treg request safety limit reached (25 per project).",
      );
    }
    // Reserve before requesting; failures can consume quota but do not cause a
    // second paid request to be issued through a retry.
    await env.KV.put(dayKey, String(used + 1), { expirationTtl: TTL_SECONDS });
    const summary =
      route === "treg_dataforseo"
        ? await fetchTregRoutedSummary(domain, { token })
        : await fetchTregBacklinksSummary(domain, { token });
    await env.KV.put(key, JSON.stringify(summary), {
      expirationTtl: TTL_SECONDS,
    });
    return { ...summary, cached: false };
  });
