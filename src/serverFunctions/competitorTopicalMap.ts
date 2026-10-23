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
      const listing = await env.R2.list({ prefix: prefix(context.projectId), limit: 1000, cursor });
      for (const object of listing.objects) {
        const stored = await env.R2.get(object.key);
        if (!stored) continue;
        try {
          const snapshot = JSON.parse(await stored.text()) as Snapshot;
          if (snapshot.projectId !== context.projectId) continue;
          results.push({
            id: snapshot.id,
            domain: snapshot.domain,
            market: snapshot.market,
            requestedLimit: snapshot.requestedLimit,
            pageCount: snapshot.pages.length,
            complete: snapshot.complete,
            savedAt: snapshot.savedAt,
          });
        } catch { /* Skip corrupt snapshots without breaking all saved research. */ }
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
