import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireProjectContext } from "@/serverFunctions/middleware";
import {
  crawlSitemapPages,
  validateSitemapUrl,
  type SitemapSnapshot,
} from "@/server/custom/sitemaps/crawler";
import { saveSitemapUrls } from "@/server/custom/sitemaps/indexCoverage";

const key = (id: string) => `custom:sitemaps:config:${id}`;
const historyKey = (id: string) => `custom:sitemaps:history:${id}`;
const request = z.object({ projectId: z.string().min(1) });
const setting = request.extend({
  sitemapUrl: z.string().max(2048),
  enabled: z.boolean(),
  indexCoverage: z.boolean(),
});
const configSchema = z.object({
  domain: z.string(),
  sitemapUrl: z.string(),
  enabled: z.boolean(),
  // Older configs predate index coverage; they are opted in.
  indexCoverage: z.boolean().default(true),
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

/** Expected, user-facing failure. Returned (not thrown) because thrown server
 *  errors reach the client only as a bare error code. */
class SitemapUserError extends Error {}
const fail = (error: unknown) => {
  if (error instanceof SitemapUserError)
    return { ok: false as const, error: error.message };
  throw error;
};

function normalizeDomain(value: string): string {
  let hostname: string;
  try {
    hostname = new URL(`https://${value}`).hostname.toLowerCase();
  } catch {
    throw new SitemapUserError("Enter a valid domain or sitemap URL");
  }
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(hostname))
    throw new SitemapUserError("Enter a valid domain or sitemap URL");
  return hostname;
}
function checkSitemapUrl(value: string, domain: string): string {
  try {
    return validateSitemapUrl(value, domain);
  } catch (error) {
    throw new SitemapUserError(
      error instanceof TypeError
        ? "Enter a valid sitemap URL"
        : `Sitemap must use HTTPS on ${domain}`,
    );
  }
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
    try {
      // Without a project domain, the sitemap URL's host becomes the monitored domain.
      let domain: string;
      if (context.project.domain) {
        domain = normalizeDomain(context.project.domain);
      } else {
        if (!data.sitemapUrl)
          throw new SitemapUserError(
            "Enter a sitemap URL or set a project domain",
          );
        let host: string;
        try {
          host = new URL(data.sitemapUrl).hostname;
        } catch {
          throw new SitemapUserError("Enter a valid sitemap URL");
        }
        domain = normalizeDomain(host);
      }
      const sitemapUrl = checkSitemapUrl(
        data.sitemapUrl || `https://${domain}/sitemap.xml`,
        domain,
      );
      const config: SitemapConfig = {
        domain,
        sitemapUrl,
        enabled: data.enabled,
        indexCoverage: data.indexCoverage,
      };
      await env.KV.put(key(context.projectId), JSON.stringify(config));
      return { ok: true as const, config };
    } catch (error) {
      return fail(error);
    }
  });
export const scanSitemapNow = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(request)
  .handler(async ({ context }) => {
    try {
      const raw = await env.KV.get(key(context.projectId));
      if (!raw) throw new SitemapUserError("Save the sitemap settings first");
      const config = configSchema.parse(JSON.parse(raw) as unknown);
      const domain = context.project.domain
        ? normalizeDomain(context.project.domain)
        : config.domain;
      if (domain !== config.domain)
        throw new SitemapUserError(
          "Project domain changed; save the sitemap settings again",
        );
      const previous = await history(context.projectId);
      const last = previous[0];
      if (last && Date.now() - Date.parse(last.scannedAt) < 10 * 60 * 1000)
        throw new SitemapUserError("Wait 10 minutes before another scan");
      const { snapshot, urls } = await crawlSitemapPages(
        domain,
        config.sitemapUrl,
      );
      await env.KV.put(
        historyKey(context.projectId),
        JSON.stringify([snapshot, ...previous].slice(0, 24)),
      );
      await saveSitemapUrls(env.KV, context.projectId, urls);
      return { ok: true as const, snapshot };
    } catch (error) {
      return fail(error);
    }
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
        const { snapshot, urls } = await crawlSitemapPages(
          config.domain,
          config.sitemapUrl,
        );
        const previous = await kv.get(historyKey(projectId));
        const records = previous
          ? historySchema.parse(JSON.parse(previous) as unknown)
          : [];
        await kv.put(
          historyKey(projectId),
          JSON.stringify([snapshot, ...records].slice(0, 24)),
        );
        await saveSitemapUrls(kv, projectId, urls);
      } catch (err) {
        console.error("[sitemap] monthly check failed", item.name, err);
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
}
