import { z } from "zod";
import {
  callSerpstat,
  databaseFor,
  keywordRowSchema,
  labsKeyword,
  ROW_USD,
  rows,
  size,
  text,
  unsupported,
  type Answer,
  type KeywordRow,
  type Task,
} from "@/server/custom/providers/treg/serpstatClient";
import {
  domainOverview,
  rankedKeywords,
  relevantPages,
} from "@/server/custom/providers/treg/serpstatDomain";

/**
 * treg → Serpstat answers the app's DataForSEO requests with Serpstat data in
 * DataForSEO's response shape, so every parser, cache and page stays the same.
 * Fields Serpstat does not have (monthly trend, SERP titles) come back null.
 * Requests Serpstat cannot answer faithfully (city or mobile SERPs, column
 * filters) fail with PROVIDER_ROUTE_UNSUPPORTED instead of returning
 * different data.
 */

/** Upper bound for one keyword's SERP (Serpstat returns ~10-20 rows). */
export const SERPSTAT_SERP_USD = 20 * ROW_USD;
/** One keyword's volume, CPC and difficulty. */
export const SERPSTAT_KEYWORD_USD = ROW_USD;

const KEYWORDS = "serpstat.google.keywords.ideas";
const VOLUME = "serpstat.google.keywords.volume";
const SERP = "serpstat.google.serp.organic";

/** A Google Ads keywords_data item (competition_index is 0-100). */
function adsKeyword(row: KeywordRow) {
  return {
    keyword: row.keyword,
    search_volume: row.region_queries_count ?? null,
    cpc: row.cost ?? null,
    competition_index: row.concurrency ?? null,
    monthly_searches: null,
  };
}

async function keywordList(task: Task, method: string) {
  const se = databaseFor(task);
  const seed =
    text(task.keyword) ||
    text(Array.isArray(task.keywords) ? task.keywords[0] : undefined);
  const { data, total } = await callSerpstat(KEYWORDS, method, {
    keyword: seed,
    se,
    size: size(task),
    withIntents: true,
    sort: { region_queries_count: "desc" },
  });
  return { list: rows(keywordRowSchema, data), total };
}

async function keywordsInfo(task: Task) {
  const keywords = Array.isArray(task.keywords) ? task.keywords : [];
  const { data } = await callSerpstat(
    VOLUME,
    "SerpstatKeywordProcedure.getKeywordsInfo",
    {
      keywords,
      se: databaseFor(task),
      withIntents: true,
    },
  );
  return rows(keywordRowSchema, data);
}

const SERP_FEATURE_NAMES: Record<string, string> = {
  also_asks: "people_also_ask",
  related_search: "related_searches",
  kn_graph_card: "knowledge_graph",
};

const serpSchema = z.object({
  top: z
    .array(
      z.object({
        position: z.number(),
        url: z.string(),
        domain: z.string(),
        subdomain: z.string().nullish(),
      }),
    )
    .default([]),
  types: z.array(z.string()).default([]),
});

async function organicSerp(task: Task): Promise<Answer> {
  if (task.device === "mobile")
    unsupported("mobile results are not available, only desktop");
  const { data } = await callSerpstat(
    SERP,
    "SerpstatKeywordProcedure.getKeywordTop",
    {
      keyword: text(task.keyword),
      se: databaseFor(task),
    },
  );
  const serp = serpSchema.parse(Array.isArray(data) ? {} : data);
  const depth = typeof task.depth === "number" ? task.depth : 100;
  const organic = serp.top
    .filter((row) => row.position <= depth)
    .map((row) => ({
      type: "organic",
      rank_group: row.position,
      rank_absolute: row.position,
      domain: row.subdomain ?? row.domain,
      url: row.url,
      title: null,
      description: null,
    }));
  const features = serp.types
    .filter((type) => !type.startsWith("snip_"))
    .map((type) => ({ type: SERP_FEATURE_NAMES[type] ?? type }));
  return {
    result: [{ items: [...organic, ...features] }],
    cost: Math.max(1, serp.top.length) * ROW_USD,
  };
}

async function autocomplete(task: Task): Promise<Answer> {
  const { list } = await keywordList(
    { ...task, limit: 10 },
    "SerpstatKeywordProcedure.getSuggestions",
  );
  return {
    result: [
      {
        items: list.map((row) => ({
          type: "autocomplete",
          suggestion: row.keyword,
        })),
      },
    ],
    cost: Math.max(1, list.length) * ROW_USD,
  };
}

function labsItems(list: KeywordRow[], wrap: boolean): Answer {
  return {
    result: [
      {
        items: list.map((row) =>
          wrap ? { keyword_data: labsKeyword(row) } : labsKeyword(row),
        ),
      },
    ],
    cost: Math.max(1, list.length) * ROW_USD,
  };
}

const HANDLERS: Record<string, (task: Task) => Promise<Answer>> = {
  "/v3/dataforseo_labs/google/related_keywords/live": async (task) =>
    labsItems(
      (await keywordList(task, "SerpstatKeywordProcedure.getRelatedKeywords"))
        .list,
      true,
    ),
  "/v3/dataforseo_labs/google/keyword_suggestions/live": async (task) =>
    labsItems(
      (await keywordList(task, "SerpstatKeywordProcedure.getKeywords")).list,
      false,
    ),
  "/v3/dataforseo_labs/google/keyword_ideas/live": async (task) =>
    labsItems(
      (await keywordList(task, "SerpstatKeywordProcedure.getRelatedKeywords"))
        .list,
      false,
    ),
  "/v3/dataforseo_labs/google/keyword_overview/live": async (task) =>
    labsItems(await keywordsInfo(task), false),
  "/v3/keywords_data/google_ads/search_volume/live": async (task) => {
    const list = await keywordsInfo(task);
    return {
      result: list.map(adsKeyword),
      cost: Math.max(1, list.length) * ROW_USD,
    };
  },
  "/v3/keywords_data/google_ads/keywords_for_keywords/live": async (task) => {
    const { list } = await keywordList(
      task,
      "SerpstatKeywordProcedure.getRelatedKeywords",
    );
    return {
      result: list.map(adsKeyword),
      cost: Math.max(1, list.length) * ROW_USD,
    };
  },
  "/v3/serp/google/organic/live/advanced": organicSerp,
  "/v3/serp/google/autocomplete/live/advanced": autocomplete,
  "/v3/dataforseo_labs/google/domain_rank_overview/live": domainOverview,
  "/v3/dataforseo_labs/google/ranked_keywords/live": rankedKeywords,
  "/v3/dataforseo_labs/google/relevant_pages/live": relevantPages,
};

/**
 * Answer one DataForSEO request with Serpstat data, as the Response the
 * DataForSEO transport would have received.
 */
export async function fetchDataforseoViaSerpstat(
  method: "GET" | "POST",
  path: string,
  body: unknown,
): Promise<Response> {
  const handler = method === "POST" ? HANDLERS[path] : undefined;
  const task = z
    .record(z.string(), z.unknown())
    .safeParse(Array.isArray(body) ? body[0] : undefined);
  if (!handler || !task.success)
    unsupported(`${method} ${path} has no Serpstat equivalent`);
  const { result, cost } = await handler(task.data);
  return Response.json({
    status_code: 20000,
    status_message: "Ok.",
    tasks: [
      {
        status_code: 20000,
        status_message: "Ok.",
        path: path.split("/").filter(Boolean),
        cost,
        data: task.data,
        result,
      },
    ],
  });
}
