import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireProjectContext } from "@/serverFunctions/middleware";
import { domainField } from "@/types/schemas/domain";

const projectInput = z.object({ projectId: z.string().uuid() });
const pageSchema = z.object({
  page: z.string().url().max(2048),
  relativePath: z.string().nullable(),
  organicTraffic: z.number().nullable(),
  keywords: z.number().nullable(),
});
const snapshotSchema = projectInput.extend({
  domain: domainField,
  market: z.number().int().positive(),
  requestedLimit: z.number().int().min(25).max(1000),
  pages: z.array(pageSchema).max(1000),
  complete: z.boolean(),
});
const readInput = projectInput.extend({ id: z.string().uuid() });
const prefix = (projectId: string) => `competitor-topical-map/${projectId}/`;
const objectKey = (projectId: string, id: string) => `${prefix(projectId)}${id}.json`;

type Snapshot = z.output<typeof snapshotSchema> & { id: string; savedAt: string };

export const saveCompetitorTopicalMap = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(snapshotSchema)
  .handler(async ({ data, context }) => {
    const id = crypto.randomUUID();
    const snapshot: Snapshot = {
      ...data,
      projectId: context.projectId,
      id,
      savedAt: new Date().toISOString(),
    };
    await env.R2.put(objectKey(context.projectId, id), JSON.stringify(snapshot), {
      httpMetadata: { contentType: "application/json" },
      customMetadata: { domain: snapshot.domain, market: String(snapshot.market), requestedLimit: String(snapshot.requestedLimit), pageCount: String(snapshot.pages.length), complete: String(snapshot.complete), savedAt: snapshot.savedAt },
    });
    return { id, savedAt: snapshot.savedAt };
  });

export const listCompetitorTopicalMaps = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectInput)
  .handler(async ({ context }) => {
    const results: Array<{
      id: string; domain: string; market: number; requestedLimit: number;
      pageCount: number; complete: boolean; savedAt: string;
    }> = [];
    let cursor: string | undefined;
    do {
      const listing = await env.R2.list({ prefix: prefix(context.projectId), limit: 1000, cursor, include: ["customMetadata"] });
      for (const object of listing.objects) {
        const meta = object.customMetadata;
        if (!meta?.domain || !meta.savedAt) continue;
        const id = object.key.slice(prefix(context.projectId).length).replace(/\.json$/, "");
        if (!z.string().uuid().safeParse(id).success) continue;
        results.push({
          id,
          domain: meta.domain,
          market: Number(meta.market),
          requestedLimit: Number(meta.requestedLimit),
          pageCount: Number(meta.pageCount),
          complete: meta.complete === "true",
          savedAt: meta.savedAt,
        });
      }
      cursor = listing.truncated ? listing.cursor : undefined;
    } while (cursor && results.length < 100);
    return results.sort((a, b) => b.savedAt.localeCompare(a.savedAt)).slice(0, 100);
  });

export const getCompetitorTopicalMap = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(readInput)
  .handler(async ({ data, context }) => {
    const stored = await env.R2.get(objectKey(context.projectId, data.id));
    if (!stored) return null;
    const parsed = JSON.parse(await stored.text()) as Snapshot;
    if (parsed.projectId !== context.projectId || parsed.id !== data.id) return null;
    return parsed;
  });

export const deleteCompetitorTopicalMap = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(readInput)
  .handler(async ({ data, context }) => {
    await env.R2.delete(objectKey(context.projectId, data.id));
    return { deleted: true };
  });

import { AuditRepository } from "@/server/features/audit/repositories/AuditRepository";

const crawlImportSchema = projectInput.extend({
  auditId: z.string().uuid(),
  competitorDomain: domainField,
  maxPages: z.number().int().min(25).max(1000),
});

export const getCompetitorCrawlHistory = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectInput)
  .handler(async ({ context }) => {
    const history = await AuditRepository.getAuditsByProject(context.projectId);
    return history.filter((audit) => audit.status === "completed").map((audit) => ({
      id: audit.id, startUrl: audit.startUrl, pagesCrawled: audit.pagesCrawled,
      completedAt: audit.completedAt,
    }));
  });

export const importCompetitorCrawl = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(crawlImportSchema)
  .handler(async ({ data, context }) => {
    const result = await AuditRepository.getAuditResultsForProject(data.auditId, context.projectId);
    if (!result.audit || result.audit.status !== "completed") {
      throw new Error("Choose a completed crawl from this project.");
    }
    const crawlHost = new URL(result.audit.startUrl).hostname.replace(/^www\./, "").toLowerCase();
    if (crawlHost !== data.competitorDomain) {
      throw new Error("The selected crawl belongs to a different domain.");
    }
    const pages = result.pages.filter((p) => {
      try {
        return new URL(p.url).hostname.replace(/^www\./, "").toLowerCase() === data.competitorDomain;
      } catch { return false; }
    }).slice(0, data.maxPages);
    return pages.map((p) => ({
      page: p.url,
      relativePath: new URL(p.url).pathname,
      organicTraffic: null,
      keywords: null,
    }));
  });
