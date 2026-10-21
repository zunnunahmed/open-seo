import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireProjectContext } from "@/serverFunctions/middleware";
import {
  crawlSitemaps,
  validateSitemapUrl,
  type SitemapSnapshot,
} from "@/server/custom/sitemaps/crawler";

const key = (id: string) => `custom:sitemaps:config:${id}`;
const historyKey = (id: string) => `custom:sitemaps:history:${id}`;
const request = z.object({ projectId: z.string().min(1) });
const setting = request.extend({
  sitemapUrl: z.string().max(2048),
  enabled: z.boolean(),
});
const configSchema = z.object({
  domain: z.string(),
  sitemapUrl: z.string(),
  enabled: z.boolean(),
});
const historySchema = z.array(
  z.object({
    scannedAt: z.string(),
    sitemapCount: z.number(),
    urlCount: z.number(),
    duplicateUrls: z.number(),
    errors: z.array(z.string()),
    complete: z.boolean(),
  }),
);
type SitemapConfig = z.infer<typeof configSchema>;
function normalizeDomain(value: string): string {
  const hostname = new URL(`https://${value}`).hostname.toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(hostname))
    throw new Error("Set a valid project domain first");
  return hostname;
}
async function history(id: string): Promise<SitemapSnapshot[]> {
  const raw = await env.KV.get(historyKey(id));
  return raw ? historySchema.parse(JSON.parse(raw) as unknown) : [];
}
export const getSitemapMonitor = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(request)
  .handler(async ({ context }) => {
    const raw = await env.KV.get(key(context.projectId));
    return {
      config: raw ? configSchema.parse(JSON.parse(raw) as unknown) : null,
      history: await history(context.projectId),
    };
  });
export const configureSitemapMonitor = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(setting)
  .handler(async ({ data, context }) => {
    const domain = normalizeDomain(context.project.domain ?? "");
    const sitemapUrl = validateSitemapUrl(
      data.sitemapUrl || `https://${domain}/sitemap.xml`,
      domain,
    );
    const config: SitemapConfig = { domain, sitemapUrl, enabled: data.enabled };
    await env.KV.put(key(context.projectId), JSON.stringify(config));
    return config;
  });
export const scanSitemapNow = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(request)
  .handler(async ({ context }) => {
    const raw = await env.KV.get(key(context.projectId));
    if (!raw) throw new Error("Configure the sitemap monitor first");
    const config = configSchema.parse(JSON.parse(raw) as unknown);
    const domain = normalizeDomain(context.project.domain ?? "");
    if (domain !== config.domain)
      throw new Error("Project domain changed; update sitemap configuration");
    const previous = await history(context.projectId);
    const last = previous[0];
    if (last && Date.now() - Date.parse(last.scannedAt) < 10 * 60 * 1000)
      throw new Error("Wait 10 minutes before another scan");
    const result = await crawlSitemaps(domain, config.sitemapUrl);
    await env.KV.put(
      historyKey(context.projectId),
      JSON.stringify([result, ...previous].slice(0, 24)),
    );
    return result;
  });
export async function runScheduledSitemapMonitoring(
  kv: Env["KV"],
): Promise<void> {
  // Scheduled monthly. Prefix-list pagination supports arbitrarily many projects.
  let cursor: string | undefined;
  do {
    const page = await kv.list({
      prefix: "custom:sitemaps:config:",
      limit: 100,
      ...(cursor ? { cursor } : {}),
    });
    for (const item of page.keys) {
      try {
        const projectId = item.name.slice("custom:sitemaps:config:".length);
        const raw = await kv.get(item.name);
        if (!raw) continue;
        const config = configSchema.parse(JSON.parse(raw) as unknown);
        if (!config.enabled) continue;
        const result = await crawlSitemaps(config.domain, config.sitemapUrl);
        const previous = await kv.get(historyKey(projectId));
        const records = previous
          ? historySchema.parse(JSON.parse(previous) as unknown)
          : [];
        await kv.put(
          historyKey(projectId),
          JSON.stringify([result, ...records].slice(0, 24)),
        );
      } catch (err) {
        console.error("[sitemap] monthly check failed", item.name, err);
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
}
