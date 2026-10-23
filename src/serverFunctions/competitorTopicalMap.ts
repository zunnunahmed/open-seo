import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  parseModelJson,
  readModelClusters,
} from "@/server/custom/competitors/aiClusters";
import { requireProjectContext } from "@/serverFunctions/middleware";
import { domainField } from "@/types/schemas/domain";
import { AuditRepository } from "@/server/features/audit/repositories/AuditRepository";

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
    return history.map((audit) => ({
      id: audit.id, startUrl: audit.startUrl, pagesCrawled: audit.pagesCrawled,
      completedAt: audit.completedAt, status: audit.status,
    }));
  });

export const importCompetitorCrawl = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(crawlImportSchema)
  .handler(async ({ data, context }) => {
    const result = await AuditRepository.getAuditResultsForProject(data.auditId, context.projectId);
    if (!result.audit) {
      throw new Error("Audit not found in this project.");
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
    if (pages.length === 0) throw new Error("No saved pages are available for this audit yet.");
    return pages.map((p) => ({
      page: p.url,
      relativePath: new URL(p.url).pathname,
      organicTraffic: null,
      keywords: null,
    }));
  });

const aiClusterSchema = z.object({
  name: z.string().min(1).max(120),
  intent: z.string().max(100),
  urls: z.array(z.string().url()).max(100),
});
const aiResultSchema = z.object({
  clusters: z.array(aiClusterSchema).min(1).max(30),
});
const UNASSIGNED_CLUSTER = "Other (not grouped by the model)";
class OpenRouterHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}
const aiInput = readInput.extend({ confirmCost: z.literal(true), startIndex: z.number().int().min(0).max(999) });
const AI_BATCH_SIZE = 15;
const aiKey = (projectId: string, id: string) => `${prefix(projectId)}ai/${id}.json`;

export const getTopicalAiAnalysis = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(readInput)
  .handler(async ({ data, context }) => {
    const stored = await env.R2.get(aiKey(context.projectId, data.id));
    if (!stored) return null;
    return JSON.parse(await stored.text()) as {
      model: string; savedAt: string; sourcePages: number;
      clusters: z.infer<typeof aiClusterSchema>[];
    };
  });

export const analyseTopicalMapWithAi = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(aiInput)
  .handler(async ({ data, context }) => {
    try {
    const stored = await env.R2.get(objectKey(context.projectId, data.id));
    if (!stored) throw new Error("Save competitor research before starting AI clustering.");
    const snapshot = JSON.parse(await stored.text()) as Snapshot;
    if (snapshot.id !== data.id || snapshot.projectId !== context.projectId) {
      throw new Error("Saved analysis does not belong to this project.");
    }
    if (snapshot.pages.length === 0) throw new Error("No saved URLs available.");
    const existingObject = await env.R2.get(aiKey(context.projectId, data.id));
    const previous = existingObject ? JSON.parse(await existingObject.text()) as {
      model: string; savedAt: string; sourcePages: number;
      clusters: z.infer<typeof aiClusterSchema>[];
    } : null;
    const currentOffset = previous?.sourcePages ?? 0;
    if (data.startIndex !== currentOffset) {
      throw new Error("Saved AI progress has changed. Reopen this analysis and resume.");
    }
    if (currentOffset >= snapshot.pages.length) return { ok: true as const, ...previous! };

    const { getOptionalEnvValue } = await import("@/server/lib/runtime-env");
    const { ProjectContextRepository } = await import("@/server/features/project-context/repositories/ProjectContextRepository");
    const apiKey = await getOptionalEnvValue("OPENROUTER_API_KEY");
    if (!apiKey) throw new Error("Configure OpenRouter under Project Integrations first.");
    const sections = await ProjectContextRepository.listSections(context.projectId);
    const model = sections.find((entry) => entry.key === "custom:openrouter-model")?.content || "openai/gpt-4o-mini";
    if (previous && previous.model !== model) throw new Error("The AI model has changed. Use the original model to resume this analysis.");
    const inputs = snapshot.pages.slice(currentOffset, currentOffset + AI_BATCH_SIZE).map((page) => ({
      url: page.page,
      path: page.relativePath ?? new URL(page.page).pathname,
    }));
    const systemPrompt = "Group the supplied website URL paths by likely topic and search intent. Return ONLY a JSON object: {\"clusters\":[{\"name\":string,\"intent\":string,\"indices\":number[]}]}. The indices are zero-based positions in the supplied pages array. Include each index 0 through N-1 exactly once. Never output URLs, markdown, or extra fields. Do not invent page contents; categories are inferred only from paths.";
    // JSON mode is requested from providers that support it
    // (require_parameters). Some providers' JSON mode still returns junk (a
    // bare number), and some models have no JSON-mode provider at all, so a
    // failed first attempt is retried once as plain text.
    const ask = async (jsonMode: boolean): Promise<string> => {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          temperature: 0.1,
          max_tokens: 4000,
          ...(jsonMode
            ? { response_format: { type: "json_object" }, provider: { require_parameters: true } }
            : {}),
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: JSON.stringify({ domain: snapshot.domain, pages: inputs }) },
          ],
        }),
        signal: AbortSignal.timeout(45000),
      });
      if (!response.ok) {
        // OpenRouter explains refusals (unknown model, no credit, no JSON
        // mode) in error.message; show it instead of a bare status.
        const body = await response.text();
        let reason = "";
        try {
          reason = z.object({ error: z.object({ message: z.string() }) })
            .parse(JSON.parse(body)).error.message;
        } catch { /* not OpenRouter's JSON error shape */ }
        throw new OpenRouterHttpError(response.status, `OpenRouter request failed (HTTP ${response.status}${reason ? `: ${reason.slice(0, 200)}` : ""}). Check the model in Project Integrations and your OpenRouter credits.`);
      }
      const payload = z.object({
        choices: z.array(z.object({ message: z.object({ content: z.string().nullish() }).nullish() })).optional(),
      }).parse(await response.json());
      return payload.choices?.[0]?.message?.content ?? "";
    };

    let parsed: z.infer<typeof aiResultSchema> | undefined;
    let raw = "";
    let lastError: unknown;
    for (const jsonMode of [true, false]) {
      try {
        raw = await ask(jsonMode);
      } catch (error) {
        // 400/404 means no provider takes JSON mode for this model; any other
        // failure (key, credits, outage) is not fixed by asking again.
        if (jsonMode && error instanceof OpenRouterHttpError && (error.status === 400 || error.status === 404)) {
          lastError = error;
          continue;
        }
        throw error;
      }
      try {
        const { clusters, skipped } = readModelClusters(parseModelJson(raw), inputs);
        if (skipped.length > 0) {
          clusters.push({ name: UNASSIGNED_CLUSTER, intent: "unknown", urls: skipped });
        }
        parsed = aiResultSchema.parse({ clusters: clusters.slice(0, 30) });
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!parsed) {
      const error = lastError;
      const detail = error instanceof SyntaxError ? "The AI model returned incomplete or invalid JSON." :
        error instanceof z.ZodError ? `The AI model returned unexpected values (${error.issues[0]?.path.join(".") || "root"}: ${error.issues[0]?.message ?? "invalid"}).` :
        error instanceof Error ? error.message : "Invalid JSON result.";
      // A short preview of the answer makes a model-specific shape diagnosable.
      const preview = raw.replace(/\s+/g, " ").slice(0, 160) || "(empty)";
      throw new Error(`AI output validation failed after a retry with ${model}: ${detail} Model answer starts: ${preview} Try another model in Project Integrations. No results saved.`, { cause: error });
    }
    const clusters = [...(previous?.clusters ?? [])];
    for (const group of parsed.clusters) {
      const match = clusters.find((old) => old.name.toLowerCase() === group.name.toLowerCase());
      if (match) match.urls.push(...group.urls);
      else clusters.push(group);
    }
    const result = { model, savedAt: new Date().toISOString(), sourcePages: currentOffset + inputs.length, clusters };
    await env.R2.put(aiKey(context.projectId, data.id), JSON.stringify(result), {
      httpMetadata: { contentType: "application/json" },
    });
    return { ok: true as const, ...result };
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI request failed.";
      console.error("Competitor AI clustering failed", { projectId: context.projectId, error: message });
      return { ok: false as const, message: message.slice(0, 300) };
    }
  });
