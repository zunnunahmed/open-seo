import { sort } from "remeda";

/**
 * Google Search suggestions miner ("alphabet soup" keyword research).
 *
 * Expands each seed keyword with a modifier placed BEFORE and AFTER it
 * (letters a–z, question words, commercial terms) and reads the live
 * autocomplete suggestions for every expansion. Free — no DataForSEO credit
 * involved.
 *
 * Google rate-limits datacenter IPs, so the run starts with a one-query
 * probe per provider (Google → DuckDuckGo → Yahoo) and mines everything
 * through the first provider that answers with data. The answering provider
 * is reported back so the UI can label the source honestly.
 */

const REQUEST_TIMEOUT_MS = 8_000;
/** Parallel suggest requests; modest bursts stay under rate limits. */
const MAX_CONCURRENT_REQUESTS = 3;
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

export type SuggestSource = "google" | "duckduckgo" | "yahoo";

export const SUGGEST_SOURCE_LABELS: Record<SuggestSource, string> = {
  google: "Google",
  duckduckgo: "DuckDuckGo",
  yahoo: "Yahoo",
};

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
  source: SuggestSource;
  /** "ok", "empty", "http 429", or "error". */
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
  source: SuggestSource,
  query: string,
  hl: string,
  gl: string,
): string {
  if (source === "duckduckgo") {
    return (
      `https://duckduckgo.com/ac/?` +
      new URLSearchParams({ q: query, kl: `${gl}-${hl}` }).toString()
    );
  }
  if (source === "yahoo") {
    return (
      `https://search.yahoo.com/sugg/chrome?` +
      new URLSearchParams({ output: "fxjson", command: query }).toString()
    );
  }
  return (
    `https://suggestqueries.google.com/complete/search?` +
    new URLSearchParams({ client: "firefox", q: query, hl, gl }).toString()
  );
}

function parseSuggestions(source: SuggestSource, json: unknown): string[] {
  if (source === "duckduckgo") {
    if (!Array.isArray(json)) return [];
    return json
      .map((entry) =>
        typeof entry === "object" && entry !== null
          ? (entry as { phrase?: unknown }).phrase
          : null,
      )
      .filter(
        (phrase): phrase is string =>
          typeof phrase === "string" && phrase.length > 0,
      );
  }
  // Google (client=firefox) and Yahoo (output=fxjson) both answer
  // ["query", ["suggestion", ...], ...].
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
  source: SuggestSource,
  query: string,
  hl: string,
  gl: string,
): Promise<SuggestFetchOutcome> {
  try {
    const response = await fetch(endpointUrl(source, query, hl, gl), {
      headers: { "User-Agent": BROWSER_USER_AGENT },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return { suggestions: [], result: `http ${response.status}` };
    const suggestions = parseSuggestions(source, await response.json());
    return {
      suggestions,
      result: suggestions.length > 0 ? "ok" : "empty",
    };
  } catch {
    return { suggestions: [], result: "error" };
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
  /** The provider that actually answered, or null when none did. */
  source: SuggestSource | null;
  probeLog: SuggestProbeEntry[];
}> {
  const seeds = [...new Set(input.seeds.map((seed) => seed.trim()))].filter(
    (seed) => seed.length > 0,
  );

  // Probe each provider with the raw first seed; mine through the first
  // one that answers with data instead of hammering a blocked endpoint.
  const sources: SuggestSource[] = ["google", "duckduckgo", "yahoo"];
  const probeLog: SuggestProbeEntry[] = [];
  let source: SuggestSource | null = null;
  for (const candidate of sources) {
    const probe = await fetchSuggestions(
      candidate,
      seeds[0] ?? "",
      input.hl,
      input.gl,
    );
    probeLog.push({ source: candidate, result: probe.result });
    if (probe.result === "ok") {
      source = candidate;
      break;
    }
  }
  if (!source) {
    return { rows: [], queriesRun: 0, seedsMined: seeds, source: null, probeLog };
  }

  const expansions = seeds
    .flatMap((seed) => expandSeed(seed, input.groups))
    .slice(0, MAX_EXPANSIONS);

  const byKeyword = new Map<string, SuggestionRow>();
  const queue = [...expansions];
  async function worker() {
    while (queue.length > 0) {
      const expansion = queue.shift();
      if (!expansion) return;
      const { suggestions } = await fetchSuggestions(
        source as SuggestSource,
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
    source,
    probeLog,
  };
}
