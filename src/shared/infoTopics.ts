/**
 * Info Topic Extraction: for each original topic, the search keyword that
 * best represents it, taken from what Google's top pages already rank for.
 */
type InfoTopicMatch = "existing" | "word" | "ai";

export type InfoTopicRow = {
  topic: string;
  /** The keyword chosen to represent the topic; null when none matched. */
  infoTopic: string | null;
  volume: number | null;
  difficulty: number | null;
  cpc: number | null;
  intent: string | null;
  /** existing: the topic itself is searched; word/ai: picked from a page. */
  matchedBy: InfoTopicMatch | null;
  /** Which of Google's top 3 results the keyword came from (1-3). */
  urlRank: number | null;
  url: string | null;
  /** That page's Google position for the keyword. */
  position: number | null;
  /** Google shows an AI Overview for the topic. */
  aiOverview: boolean | null;
};

/** Topics per request: a batch stays inside Workers Free request limits. */
export const INFO_TOPIC_BATCH = 5;
export const MAX_INFO_TOPICS = 5000;

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "of",
  "for",
  "to",
  "in",
  "on",
  "with",
  "at",
  "by",
  "from",
  "is",
  "are",
  "be",
  "your",
  "you",
  "my",
  "our",
  "it",
  "its",
  "how",
  "what",
  "why",
  "when",
  "which",
  "who",
  "vs",
  "do",
  "does",
  "can",
]);

/** A word without a plural ending, so "exercises" matches "exercise". */
function stem(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && /(ches|shes|xes|sses)$/.test(word))
    return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss"))
    return word.slice(0, -1);
  return word;
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** The words that carry a topic's meaning, without small words or plurals. */
function topicWords(text: string): string[] {
  return [
    ...new Set(
      words(text)
        .filter((word) => !STOP_WORDS.has(word))
        .map(stem),
    ),
  ];
}

/**
 * The keyword contains every main word of the topic, and is not one of the
 * stuttering variants keyword databases hold ("carpal tunnel carpal tunnel").
 */
export function isWordMatch(topic: string, keyword: string): boolean {
  const needed = topicWords(topic);
  if (needed.length === 0) return false;
  const all = words(keyword).map(stem);
  if (new Set(all).size !== all.length) return false;
  const have = new Set(all);
  return needed.every((word) => have.has(word));
}
