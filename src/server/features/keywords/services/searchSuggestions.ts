import { sort } from "remeda";
import { z } from "zod";
import { createDataforseoClient } from "@/server/lib/dataforseo";
import type { LabsKeywordDataItem } from "@/server/lib/dataforseo";
import type { BillingCustomerContext } from "@/server/billing/subscription";
import {
  buildCacheKey,
  CACHE_TTL,
  getCached,
  setCached,
} from "@/server/lib/r2-cache";
import {
  normalizeIntent,
  normalizeKeyword,
} from "@/server/features/keywords/services/research/helpers";

/**
 * Google Search suggestions miner ("alphabet soup" keyword research).
 *
 * Expands each seed keyword with a modifier placed BEFORE and AFTER it
 * (letters a–z, question words, commercial terms) and reads the live Google
 * autocomplete suggestions for every expansion. Free — no DataForSEO credit
 * involved.
 *
 * Google rate-limits datacenter IPs, so the run probes three Google suggest
 * endpoints in order (suggestqueries → www.google.com → clients1 toolbar
 * host) and mines everything through the first one that answers with data,
 * at low concurrency with a small stagger between requests. Google only —
 * no third-party suggestion providers.
 */

const REQUEST_TIMEOUT_MS = 8_000;
/** Parallel suggest requests; low enough to stay under abuse thresholds. */
const MAX_CONCURRENT_REQUESTS = 2;
/** Breathing room between requests so a 98-query burst reads less bot-like. */
const INTER_REQUEST_DELAY_MS = 120;
/** Hard cap on expansions per mining run so 3 long seeds can't fan out. */
const MAX_EXPANSIONS = 300;

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Accept: "*/*",
  "Accept-Language": "en-US,en;q=0.9",
};

export const SUGGESTION_MODIFIER_GROUPS = {
  letters: "abcdefghijklmnopqrstuvwxyz".split(""),
  questions: [
    "who",
    "what",
    "where",
    "when",
    "why",
    "how",
    "which",
    "are",
    "can",
    "will",
    "should",
    "does",
  ],
  commercial: [
    "best",
    "top",
    "cheap",
    "price",
    "cost",
    "review",
    "reviews",
    "near me",
    "for",
    "with",
    "vs",
  ],
} as const;

export type SuggestionModifierGroup = keyof typeof SUGGESTION_MODIFIER_GROUPS;
export type SuggestionPlacement = "before" | "after";

/** Google suggest endpoints in probe order, most standard first. */
const GOOGLE_ENDPOINTS = [
  { id: "suggestqueries", label: "Google suggest host" },
  { id: "www", label: "Google www host" },
  { id: "toolbar", label: "Google toolbar host" },
] as const;

export type GoogleEndpointId = (typeof GOOGLE_ENDPOINTS)[number]["id"];

export type SuggestionExpansion = {
  query: string;
  placement: SuggestionPlacement;
  modifier: string;
  seed: string;
};

export type SuggestionRow = {
  keyword: string;
  placement: SuggestionPlacement;
  modifier: string;
  seed: string;
  query: string;
};

export type SuggestProbeEntry = {
  endpoint: GoogleEndpointId;
  /** "ok", "empty", "http <status>", or "error". */
  result: string;
};

/** Every modifier crossed with one seed, modifier first then seed last. */
export function expandSeed(
  seed: string,
  groups: readonly SuggestionModifierGroup[],
): SuggestionExpansion[] {
  const modifiers = [
    ...new Set(groups.flatMap((group) => SUGGESTION_MODIFIER_GROUPS[group])),
  ];
  return modifiers.flatMap((modifier) => [
    { query: `${modifier} ${seed}`, placement: "before", modifier, seed },
    { query: `${seed} ${modifier}`, placement: "after", modifier, seed },
  ]);
}

function endpointUrl(
  endpoint: GoogleEndpointId,
  query: string,
  hl: string,
  gl: string,
): string {
  const params = new URLSearchParams({
    client: endpoint === "suggestqueries" ? "firefox" : "chrome",
    q: query,
    hl,
    gl,
  }).toString();
  if (endpoint === "www") return `https://www.google.com/complete/search?${params}`;
  if (endpoint === "toolbar")
    return `https://clients1.google.com/complete/search?${params}`;
  return `https://suggestqueries.google.com/complete/search?${params}`;
}

/**
 * Google's firefox and chrome suggest formats both answer
 * ["query", ["suggestion", ...], ...] — index 1 holds the strings.
 */
function parseSuggestions(json: unknown): string[] {
  if (!Array.isArray(json) || !Array.isArray(json[1])) return [];
  return (json[1] as unknown[]).filter(
    (entry): entry is string =>
      typeof entry === "string" && entry.length > 0,
  );
}

export type SuggestFetchOutcome = {
  suggestions: string[];
  /** "ok", "empty", "http <status>", or "error". */
  result: string;
};

/** One autocomplete lookup. Never throws — failures read as empty. */
export async function fetchSuggestions(
  endpoint: GoogleEndpointId,
  query: string,
  hl: string,
  gl: string,
): Promise<SuggestFetchOutcome> {
  try {
    const response = await fetch(endpointUrl(endpoint, query, hl, gl), {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok)
      return { suggestions: [], result: `http ${response.status}` };
    const suggestions = parseSuggestions(await response.json());
    return {
      suggestions,
      result: suggestions.length > 0 ? "ok" : "empty",
    };
  } catch {
    return { suggestions: [], result: "error" };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function mineSearchSuggestions(input: {
  seeds: string[];
  hl: string;
  gl: string;
  groups: SuggestionModifierGroup[];
}): Promise<{
  rows: SuggestionRow[];
  queriesRun: number;
  seedsMined: string[];
  /** The endpoint that answered, or null when none did. */
  endpoint: GoogleEndpointId | null;
  probeLog: SuggestProbeEntry[];
}> {
  const seeds = [...new Set(input.seeds.map((seed) => seed.trim()))].filter(
    (seed) => seed.length > 0,
  );

  // Probe each Google endpoint with the raw first seed and mine through the
  // first one that answers with data, instead of hammering a blocked host.
  const probeLog: SuggestProbeEntry[] = [];
  let endpoint: GoogleEndpointId | null = null;
  for (const candidate of GOOGLE_ENDPOINTS) {
    const probe = await fetchSuggestions(
      candidate.id,
      seeds[0] ?? "",
      input.hl,
      input.gl,
    );
    probeLog.push({ endpoint: candidate.id, result: probe.result });
    if (probe.result === "ok") {
      endpoint = candidate.id;
      break;
    }
  }
  if (!endpoint) {
    return {
      rows: [],
      queriesRun: 0,
      seedsMined: seeds,
      endpoint: null,
      probeLog,
    };
  }

  const expansions = seeds
    .flatMap((seed) => expandSeed(seed, input.groups))
    .slice(0, MAX_EXPANSIONS);

  const byKeyword = new Map<string, SuggestionRow>();
  const queue = [...expansions];
  let launched = 0;
  async function worker() {
    while (queue.length > 0) {
      const expansion = queue.shift();
      if (!expansion) return;
      // Stagger launches so the burst reads less bot-like.
      if (launched++ > 0) await sleep(INTER_REQUEST_DELAY_MS);
      const { suggestions } = await fetchSuggestions(
        endpoint as GoogleEndpointId,
        expansion.query,
        input.hl,
        input.gl,
      );
      for (const keyword of suggestions) {
        const key = keyword.toLowerCase();
        if (!byKeyword.has(key)) {
          byKeyword.set(key, { keyword, ...expansion });
        }
      }
    }
  }
  await Promise.all(
    Array.from({ length: MAX_CONCURRENT_REQUESTS }, () => worker()),
  );

  return {
    rows: sort([...byKeyword.values()], (a, b) =>
      a.keyword.localeCompare(b.keyword),
    ),
    queriesRun: expansions.length,
    seedsMined: seeds,
    endpoint,
    probeLog,
  };
}

export type DataforseoSuggestionRow = {
  keyword: string;
  placement: SuggestionPlacement;
  modifier: string;
  seed: string;
  searchVolume: number | null;
  cpc: number | null;
  /** 0-1 paid-competition ratio, as reported by Labs. */
  competition: number | null;
  keywordDifficulty: number | null;
  intent:
    | "informational"
    | "commercial"
    | "transactional"
    | "navigational"
    | "unknown";
};

const autocompleteCacheSchema = z.object({
  suggestions: z.array(z.string()),
});

/** One exact query string through DataForSEO autocomplete, cached 24h. */
async function cachedAutocomplete(
  client: ReturnType<typeof createDataforseoClient>,
  input: { query: string; locationCode: number; languageCode: string },
): Promise<string[]> {
  const key = await buildCacheKey("suggest:autocomplete", {
    query: input.query,
    locationCode: input.locationCode,
    languageCode: input.languageCode,
  });
  const cached = autocompleteCacheSchema.safeParse(await getCached(key));
  if (cached.success) return cached.data.suggestions;
  const suggestions = await client.serp.autocomplete({
    keyword: input.query,
    locationCode: input.locationCode,
    languageCode: input.languageCode,
    creditFeature: "keyword_research",
  });
  await setCached(key, { suggestions }, CACHE_TTL.researchResult);
  return suggestions;
}

const AUTOCOMPLETE_CONCURRENCY = 6;
const OVERVIEW_CHUNK_SIZE = 1000;

/**
 * DataForSEO autocomplete for every before/after expansion, then one
 * keyword_overview call per 1,000 unique suggestions for volume, CPC,
 * competition, difficulty and intent. Google-sourced and reliable where raw
 * scraping is blocked; billed per autocomplete call plus overview rows.
 */
export async function mineDataforseoSuggestions(input: {
  seeds: string[];
  locationCode: number;
  languageCode: string;
  groups: SuggestionModifierGroup[];
  billingCustomer: BillingCustomerContext;
}): Promise<{
  rows: DataforseoSuggestionRow[];
  queriesRun: number;
  seedsMined: string[];
}> {
  const client = createDataforseoClient(input.billingCustomer);
  const seeds = [...new Set(input.seeds.map((seed) => seed.trim()))].filter(
    (seed) => seed.length > 0,
  );
  const expansions = seeds
    .flatMap((seed) => expandSeed(seed, input.groups))
    .slice(0, MAX_EXPANSIONS);

  const byKeyword = new Map<string, SuggestionExpansion & { keyword: string }>();
  const queue = [...expansions];
  async function worker() {
    while (queue.length > 0) {
      const expansion = queue.shift();
      if (!expansion) return;
      const suggestions = await cachedAutocomplete(client, {
        query: expansion.query,
        locationCode: input.locationCode,
        languageCode: input.languageCode,
      }).catch(() => [] as string[]);
      for (const keyword of suggestions) {
        const key = keyword.toLowerCase();
        if (!byKeyword.has(key)) byKeyword.set(key, { ...expansion, keyword });
      }
    }
  }
  await Promise.all(
    Array.from({ length: AUTOCOMPLETE_CONCURRENCY }, () => worker()),
  );

  const keywords = [...byKeyword.keys()];
  const metrics = new Map<string, LabsKeywordDataItem>();
  for (let i = 0; i < keywords.length; i += OVERVIEW_CHUNK_SIZE) {
    const items = await client.labs.keywordOverview({
      keywords: keywords.slice(i, i + OVERVIEW_CHUNK_SIZE),
      locationCode: input.locationCode,
      languageCode: input.languageCode,
      creditFeature: "keyword_research",
    });
    for (const item of items) {
      if (item.keyword) metrics.set(normalizeKeyword(item.keyword), item);
    }
  }

  const rows: DataforseoSuggestionRow[] = [];
  for (const [key, expansion] of byKeyword) {
    const item = metrics.get(key);
    const info = item?.keyword_info_normalized_with_clickstream
      ?.search_volume
      ? item.keyword_info_normalized_with_clickstream
      : item?.keyword_info;
    rows.push({
      keyword: expansion.keyword,
      placement: expansion.placement,
      modifier: expansion.modifier,
      seed: expansion.seed,
      searchVolume: info?.search_volume ?? null,
      cpc: info?.cpc ?? null,
      competition: info?.competition ?? null,
      keywordDifficulty: item?.keyword_properties?.keyword_difficulty ?? null,
      intent: normalizeIntent(item?.search_intent_info?.main_intent),
    });
  }
  return {
    rows: sort(rows, (a, b) => (b.searchVolume ?? -1) - (a.searchVolume ?? -1)),
    queriesRun: expansions.length,
    seedsMined: seeds,
  };
}
