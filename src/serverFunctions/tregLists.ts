import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireProjectContext } from "@/serverFunctions/middleware";
import {
  getSeoProviderPreference,
  isProviderAllowed,
} from "@/server/custom/providers/projectPreference";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";
import {
  fetchTregList,
  type TregListSnapshot,
} from "@/server/custom/providers/treg/lists";

const requestSchema = z.object({
  projectId: z.string().min(1),
  domain: z.string().min(4).max(253),
  kind: z.enum(["domains", "backlinks"]),
  fetchFresh: z.boolean(),
  acknowledgeCost: z.boolean().optional(),
});
const snapshotSchema = z.object({
  provider: z.literal("serpstat-via-treg"),
  kind: z.enum(["domains", "backlinks"]),
  domain: z.string(),
  fetchedAt: z.string(),
  estimatedCostUsd: z.number(),
  total: z.number().nullable(),
  rows: z.array(
    z.object({
      source: z.string(),
      target: z.string().nullable(),
      anchor: z.string().nullable(),
      linkType: z.string().nullable(),
      firstSeen: z.string().nullable(),
      authority: z.number().nullable(),
      linkCount: z.number().nullable(),
    }),
  ),
});
function requireDomain(domain: string): string {
  const cleaned = domain.toLowerCase().trim();
  if (
    !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(cleaned)
  )
    throw new Error("Enter a bare domain, not a URL.");
  return cleaned;
}
export const getTregSavedList = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(requestSchema)
  .handler(async ({ data, context }) => {
    const preference = await getSeoProviderPreference(context.projectId);
    if (!isProviderAllowed(preference, "treg"))
      throw new Error("treg is not enabled for this project");
    const domain = requireDomain(data.domain);
    const key = `custom:treg:saved-list:v1:${context.projectId}:${domain}:${data.kind}`;
    if (!data.fetchFresh) {
      const saved = await env.KV.get(key);
      return saved
        ? { ...snapshotSchema.parse(JSON.parse(saved) as unknown), saved: true }
        : null;
    }
    if (data.acknowledgeCost !== true)
      throw new Error("Confirm paid API lookup first.");
    if ((await getOptionalEnvValue("CUSTOM_TREG_ENABLED")) !== "true")
      throw new Error("treg integration is disabled");
    const token = await getOptionalEnvValue("TREG_API_TOKEN");
    if (!token) throw new Error("treg token not configured");
    const guard = `custom:treg:list:usage:${context.projectId}:${new Date().toISOString().slice(0, 10)}`;
    const used = Number((await env.KV.get(guard)) ?? 0);
    if (used >= 20)
      throw new Error("Daily treg list quota reached (20 per project)");
    await env.KV.put(guard, String(used + 1), { expirationTtl: 86400 });
    const result: TregListSnapshot = await fetchTregList(
      data.kind,
      domain,
      token,
    );
    await env.KV.put(key, JSON.stringify(result));
    return { ...result, saved: false };
  });
