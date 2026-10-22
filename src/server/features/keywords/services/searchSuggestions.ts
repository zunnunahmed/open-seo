import { sort } from "remeda";
import { createDataforseoClient } from "@/server/lib/dataforseo";
import type { BillingCustomerContext } from "@/server/billing/subscription";
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
  seed: string;
};

/**
 * DataForSEO keyword_suggestions per seed: Google-based suggestions with
 * volume, CPC, competition, difficulty and intent, billed per row under the
 * keyword_research feature. Reliable where raw autocomplete is blocked.
 */
export async function mineDataforseoSuggestions(input: {
  seeds: string[];
  locationCode: number;
  languageCode: string;
  limitPerSeed: number;
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
  const byKeyword = new Map<string, DataforseoSuggestionRow>();
  for (const seed of seeds) {
    const items = await client.keywords.suggestions({
      keyword: seed,
      locationCode: input.locationCode,
      languageCode: input.languageCode,
      limit: input.limitPerSeed,
      creditFeature: "keyword_research",
    });
    for (const item of items) {
      if (!item.keyword) continue;
      const keyword = normalizeKeyword(item.keyword);
      if (byKeyword.has(keyword)) continue;
      const info = item.keyword_info_normalized_with_clickstream
        ?.search_volume
        ? item.keyword_info_normalized_with_clickstream
        : item.keyword_info;
      byKeyword.set(keyword, {
        keyword,
        searchVolume: info?.search_volume ?? null,
        cpc: info?.cpc ?? null,
        competition: info?.competition ?? null,
        keywordDifficulty: item.keyword_properties?.keyword_difficulty ?? null,
        intent: normalizeIntent(item.search_intent_info?.main_intent),
        seed,
      });
    }
  }
  return {
    rows: sort([...byKeyword.values()], (a, b) =>
      (b.searchVolume ?? -1) - (a.searchVolume ?? -1),
    ),
    queriesRun: seeds.length,
    seedsMined: seeds,
  };
}
