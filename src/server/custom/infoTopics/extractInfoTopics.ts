import { z } from "zod";
import type { createDataforseoClient } from "@/server/lib/dataforseo";
import { isWordMatch, type InfoTopicRow } from "@/shared/infoTopics";
import { aiPickKeyword } from "./aiPick";

type Client = ReturnType<typeof createDataforseoClient>;
type Market = { locationCode: number; languageCode: string };

/** The KV operations used (Env["KV"] satisfies it). */
type InfoTopicsKv = {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<unknown>;
};

/**
 * A page's top keywords cost one paid lookup; the same strong page ranks for
 * many topics in a map, so its keywords are kept for 28 days and reused.
 */
const URL_CACHE_SECONDS = 28 * 24 * 60 * 60;
/** Keywords read per page: the best matches come first by volume. */
const KEYWORDS_PER_URL = 20;
const TOP_URLS = 3;

const candidateSchema = z.object({
  keyword: z.string(),
  volume: z.number().nullable(),
  difficulty: z.number().nullable(),
  cpc: z.number().nullable(),
  intent: z.string().nullable(),
  position: z.number().nullable(),
});
type Candidate = z.infer<typeof candidateSchema>;

/** Fields of a ranked-keywords row this feature reads. */
const rankedRowSchema = z.object({
  keyword_data: z
    .object({
      keyword: z.string().nullish(),
      keyword_info: z
        .object({
          search_volume: z.number().nullish(),
          cpc: z.number().nullish(),
        })
        .nullish(),
      keyword_properties: z
        .object({ keyword_difficulty: z.number().nullish() })
        .nullish(),
      search_intent_info: z
        .object({ main_intent: z.string().nullish() })
        .nullish(),
    })
    .nullish(),
  ranked_serp_element: z
    .object({
      serp_item: z.object({ rank_group: z.number().nullish() }).nullish(),
    })
    .nullish(),
});

async function cacheKey(url: string, market: Market) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(url),
  );
  const hash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `custom:info-topics:url:v1:${market.locationCode}:${market.languageCode}:${hash}`;
}

/** A page's top-10 keywords by volume, from the cache or one paid lookup. */
async function pageKeywords(
  client: Client,
  kv: InfoTopicsKv,
  url: string,
  market: Market,
): Promise<Candidate[]> {
  const key = await cacheKey(url, market);
  const cached = await kv.get(key);
  if (cached) {
    const parsed = z
      .array(candidateSchema)
      .safeParse(JSON.parse(cached) as unknown);
    if (parsed.success) return parsed.data;
  }
  const response = await client.domain.rankedKeywords({
    target: url,
    locationCode: market.locationCode,
    languageCode: market.languageCode,
    limit: KEYWORDS_PER_URL,
    orderBy: ["keyword_data.keyword_info.search_volume,desc"],
    filters: ["ranked_serp_element.serp_item.rank_group", "<=", 10],
    creditFeature: "keyword_research",
  });
  const candidates = response.items.flatMap((item): Candidate[] => {
    const row = rankedRowSchema.safeParse(item);
    const data = row.success ? row.data.keyword_data : null;
    if (!row.success || !data?.keyword) return [];
    return [
      {
        keyword: data.keyword,
        volume: data.keyword_info?.search_volume ?? null,
        difficulty: data.keyword_properties?.keyword_difficulty ?? null,
        cpc: data.keyword_info?.cpc ?? null,
        intent: data.search_intent_info?.main_intent ?? null,
        position: row.data.ranked_serp_element?.serp_item?.rank_group ?? null,
      },
    ];
  });
  await kv.put(key, JSON.stringify(candidates), {
    expirationTtl: URL_CACHE_SECONDS,
  });
  return candidates;
}

const emptyRow = (topic: string, aiOverview: boolean | null): InfoTopicRow => ({
  topic,
  infoTopic: null,
  volume: null,
  difficulty: null,
  cpc: null,
  intent: null,
  matchedBy: null,
  urlRank: null,
  url: null,
  position: null,
  aiOverview,
});

/** One topic through Google's top 3 pages, stopping at the first match. */
async function extractOne(
  client: Client,
  kv: InfoTopicsKv,
  topic: string,
  market: Market,
  ai: { apiKey: string; model: string } | null,
): Promise<InfoTopicRow> {
  const serp = await client.serp.live({
    keyword: topic,
    locationCode: market.locationCode,
    languageCode: market.languageCode,
    depth: 10,
    creditFeature: "keyword_research",
  });
  const aiOverview = serp.some((item) => item.type === "ai_overview");
  const urls = serp
    .filter((item) => item.type === "organic" && item.url)
    .slice(0, TOP_URLS)
    .flatMap((item) => (item.url ? [item.url] : []));
  for (const [index, url] of urls.entries()) {
    const candidates = await pageKeywords(client, kv, url, market);
    let picked = candidates.find((candidate) =>
      isWordMatch(topic, candidate.keyword),
    );
    let matchedBy: InfoTopicRow["matchedBy"] = picked ? "word" : null;
    if (!picked && ai) {
      const choice = await aiPickKeyword(
        ai,
        topic,
        candidates.map((candidate) => candidate.keyword),
      ).catch(() => null);
      if (choice !== null) {
        picked = candidates[choice];
        matchedBy = "ai";
      }
    }
    if (picked)
      return {
        topic,
        infoTopic: picked.keyword,
        volume: picked.volume,
        difficulty: picked.difficulty,
        cpc: picked.cpc,
        intent: picked.intent,
        matchedBy,
        urlRank: index + 1,
        url,
        position: picked.position,
        aiOverview,
      };
  }
  return emptyRow(topic, aiOverview);
}

/**
 * Info topics for a batch of topics. With `acceptExisting`, topics that are
 * already searched keywords are taken as they are from one cheap bulk lookup;
 * only the rest go through Google's top pages.
 */
export async function extractInfoTopics(input: {
  client: Client;
  kv: InfoTopicsKv;
  topics: string[];
  market: Market;
  acceptExisting: boolean;
  ai: { apiKey: string; model: string } | null;
}): Promise<InfoTopicRow[]> {
  const { client, kv, topics, market, ai } = input;
  const existing = new Map<string, InfoTopicRow>();
  if (input.acceptExisting) {
    const items = await client.labs.keywordOverview({
      keywords: topics,
      locationCode: market.locationCode,
      languageCode: market.languageCode,
      creditFeature: "keyword_research",
    });
    for (const item of items) {
      const volume = item.keyword_info?.search_volume ?? 0;
      if (!item.keyword || volume <= 0) continue;
      existing.set(item.keyword.toLowerCase(), {
        ...emptyRow(item.keyword, null),
        infoTopic: item.keyword,
        volume,
        difficulty: item.keyword_properties?.keyword_difficulty ?? null,
        cpc: item.keyword_info?.cpc ?? null,
        intent: item.search_intent_info?.main_intent ?? null,
        matchedBy: "existing",
      });
    }
  }
  const settled = await Promise.allSettled(
    topics.map(async (topic) => {
      const found = existing.get(topic.toLowerCase());
      if (found) return { ...found, topic };
      return extractOne(client, kv, topic, market, ai);
    }),
  );
  // One failed topic is a blank row; all of them failing (no credits, the
  // provider down) is an error the user needs to see.
  const failed = settled.flatMap((outcome) =>
    outcome.status === "rejected" ? [outcome.reason] : [],
  );
  if (failed.length === topics.length && failed.length > 0) throw failed[0];
  return settled.map((outcome, index) => {
    if (outcome.status === "fulfilled") return outcome.value;
    console.warn("info-topics.topic failed", {
      topic: topics[index],
      error: outcome.reason,
    });
    return emptyRow(topics[index], null);
  });
}
