import { z } from "zod";

/**
 * Read the topic groups an AI model returned for one batch of pages.
 *
 * Models follow the requested {clusters:[{name,intent,indices}]} shape only
 * loosely: some return a bare array, rename keys (groups/topics, topic/title,
 * pages/urls), or list pages as numeric strings, URLs or paths. Each page is
 * kept at its first valid assignment; pages the model skipped are returned
 * separately so the caller can still save the batch.
 */
type ModelCluster = { name: string; intent: string; urls: string[] };

class ModelOutputError extends Error {}

/**
 * The JSON in a model reply: plain JSON, fenced in markdown, or wrapped in
 * prose ("Here are the groups: {...}"). Throws SyntaxError when there is none.
 */
export function parseModelJson(raw: string): unknown {
  const text = raw
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "");
  try {
    return JSON.parse(text);
  } catch (error) {
    const start = text.search(/[[{]/);
    const end = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
    if (start < 0 || end <= start) throw error;
    return JSON.parse(text.slice(start, end + 1));
  }
}

const record = z.record(z.string(), z.unknown());
const list = z.array(z.unknown());

function firstArray(value: unknown, keys: string[]): unknown[] | undefined {
  const direct = list.safeParse(value);
  if (direct.success) return direct.data;
  const parsed = record.safeParse(value);
  if (!parsed.success) return undefined;
  for (const key of keys) {
    const candidate = list.safeParse(parsed.data[key]);
    if (candidate.success) return candidate.data;
  }
  return undefined;
}

function firstText(value: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim())
      return candidate.trim();
  }
  return "";
}

export function readModelClusters(
  json: unknown,
  pages: Array<{ url: string; path: string }>,
): { clusters: ModelCluster[]; skipped: string[] } {
  const groups = firstArray(json, ["clusters", "groups", "topics", "data"]);
  if (!groups) {
    throw new ModelOutputError(
      "The AI model's answer has no list of topic groups.",
    );
  }
  // A page may be referenced by position, numeric string, URL or path.
  const indexOf = (reference: unknown): number => {
    if (typeof reference === "number") return reference;
    if (typeof reference !== "string") return -1;
    const text = reference.trim();
    if (/^\d+$/.test(text)) return Number(text);
    return pages.findIndex((page) => page.url === text || page.path === text);
  };

  const assigned = new Set<number>();
  const clusters: ModelCluster[] = [];
  groups.forEach((group, position) => {
    const fields = record.safeParse(group);
    if (!fields.success) return;
    const references =
      firstArray(group, ["indices", "pages", "urls", "items", "ids"]) ?? [];
    const urls: string[] = [];
    for (const reference of references) {
      const index = indexOf(reference);
      if (index < 0 || index >= pages.length || assigned.has(index)) continue;
      assigned.add(index);
      urls.push(pages[index].url);
    }
    if (urls.length === 0) return;
    clusters.push({
      name: (
        firstText(fields.data, ["name", "topic", "title", "label"]) ||
        `Topic ${position + 1}`
      ).slice(0, 120),
      intent: firstText(fields.data, ["intent", "search_intent"]).slice(0, 100),
      urls,
    });
  });
  if (clusters.length === 0) {
    throw new ModelOutputError(
      "The AI model's answer did not place any page in a group.",
    );
  }
  return {
    clusters,
    skipped: pages
      .filter((_, index) => !assigned.has(index))
      .map((page) => page.url),
  };
}
