import { sort } from "remeda";

/**
 * Google Search suggestions miner ("alphabet soup" keyword research).
 *
 * Expands each seed keyword with a modifier placed BEFORE and AFTER it
 * (letters a–z, question words, commercial terms) and reads the live
 * suggestions Google returns for every expansion via the public suggest
 * endpoint. Free — no DataForSEO credit involved.
 */

const SUGGEST_ENDPOINT = "https://suggestqueries.google.com/complete/search";
const REQUEST_TIMEOUT_MS = 8_000;
/** Parallel suggest requests; the endpoint is free but rate-limits bursts. */
const MAX_CONCURRENT_REQUESTS = 5;
/** Hard cap on expansions per mining run so 3 long seeds can't fan out. */
const MAX_EXPANSIONS = 300;

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

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

/** Live suggestions for one query; never throws — failures read as no data. */
async function fetchGoogleSuggestions(
  query: string,
  hl: string,
  gl: string,
): Promise<string[]> {
  const url =
    `${SUGGEST_ENDPOINT}?` +
    new URLSearchParams({ client: "firefox", q: query, hl, gl }).toString();
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": BROWSER_USER_AGENT },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return [];
    const data: unknown = await response.json();
    if (!Array.isArray(data) || !Array.isArray(data[1])) return [];
    return data[1].filter(
      (entry): entry is string => typeof entry === "string" && entry.length > 0,
    );
  } catch {
    return [];
  }
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
}> {
  const seeds = [...new Set(input.seeds.map((seed) => seed.trim()))].filter(
    (seed) => seed.length > 0,
  );
  const expansions = seeds
    .flatMap((seed) => expandSeed(seed, input.groups))
    .slice(0, MAX_EXPANSIONS);

  const byKeyword = new Map<string, SuggestionRow>();
  const queue = [...expansions];
  async function worker() {
    while (queue.length > 0) {
      const expansion = queue.shift();
      if (!expansion) return;
      const suggestions = await fetchGoogleSuggestions(
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
  };
}
