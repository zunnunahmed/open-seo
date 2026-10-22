import { z } from "zod";
import { AppError } from "@/server/lib/errors";
import {
  getIsoCountryCode,
  LOCATION_OPTIONS,
} from "@/shared/keyword-locations";
import { postToTreg } from "@/server/custom/providers/treg/dataforseoTransport";

/** Shared pieces of the treg → Serpstat adapter (see serpstatAsDataforseo). */

// treg bills Serpstat per returned row; the domain summary per domain.
export const ROW_USD = 0.0005;

export type Task = Record<string, unknown>;
/** A DataForSEO task `result` and its estimated cost. */
export type Answer = { result: unknown[]; cost: number };

export function unsupported(message: string): never {
  throw new AppError("PROVIDER_ROUTE_UNSUPPORTED", `Serpstat: ${message}`);
}

export function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Serpstat database for the task's country, e.g. g_us, g_uk. */
export function databaseFor(task: Task): string {
  if (task.location_name != null)
    unsupported("city and region locations are not available");
  const code = task.location_code;
  if (!LOCATION_OPTIONS.some((option) => option.code === code))
    unsupported(`location ${String(code)} is not available`);
  const iso = getIsoCountryCode(Number(code));
  return `g_${iso === "gb" ? "uk" : iso}`;
}

export function size(task: Task, fallback = 100): number {
  const limit = typeof task.limit === "number" ? task.limit : fallback;
  return Math.min(1000, Math.max(1, Math.round(limit)));
}

const responseSchema = z.object({
  result: z
    .object({
      data: z.unknown(),
      summary_info: z.object({ total: z.number().optional() }).optional(),
    })
    .optional(),
  error: z.object({ code: z.number(), message: z.string() }).optional(),
});

export async function callSerpstat(
  endpointId: string,
  method: string,
  params: Record<string, unknown>,
): Promise<{ data: unknown; total: number | null }> {
  const response = await postToTreg(endpointId, { id: "1", method, params });
  const body = responseSchema.parse(await response.json());
  if (body.error) {
    // Serpstat reports an empty result as an error ("SERP not found", "Data
    // not found"); that is a valid empty answer, not a failure.
    if (/not found/i.test(body.error.message)) return { data: [], total: 0 };
    throw new AppError(
      "TREG_REQUEST_FAILED",
      `Serpstat ${method}: ${body.error.message}`,
    );
  }
  return {
    data: body.result?.data ?? [],
    total: body.result?.summary_info?.total ?? null,
  };
}

export const keywordRowSchema = z
  .object({
    keyword: z.string(),
    region_queries_count: z.number().nullish(),
    cost: z.number().nullish(),
    concurrency: z.number().nullish(),
    difficulty: z.number().nullish(),
    intents: z.array(z.string()).nullish(),
  })
  .passthrough();
export type KeywordRow = z.infer<typeof keywordRowSchema>;

export function rows<T extends z.ZodTypeAny>(
  schema: T,
  data: unknown,
): z.infer<T>[] {
  return z.array(schema).parse(Array.isArray(data) ? data : []);
}

/** A Labs keyword_data item. Serpstat competition is 0-100, Labs 0-1. */
export function labsKeyword(row: KeywordRow) {
  return {
    keyword: row.keyword,
    keyword_info: {
      search_volume: row.region_queries_count ?? null,
      cpc: row.cost ?? null,
      competition: row.concurrency != null ? row.concurrency / 100 : null,
      monthly_searches: null,
    },
    keyword_properties: { keyword_difficulty: row.difficulty ?? null },
    search_intent_info: { main_intent: row.intents?.[0] ?? null },
  };
}
