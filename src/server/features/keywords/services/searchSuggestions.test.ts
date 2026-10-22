import { afterEach, describe, expect, it, vi } from "vitest";
import {
  expandSeed,
  mineSearchSuggestions,
} from "@/server/features/keywords/services/searchSuggestions";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mockSuggest(queries: Record<string, string[] | null>) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    const q = new URL(url).searchParams.get("q") ?? "";
    const suggestions = queries[q];
    if (suggestions === null) {
      return new Response("blocked", { status: 429 });
    }
    return Response.json([q, suggestions ?? []]);
  });
}

describe("expandSeed", () => {
  it("crosses every modifier before and after the seed", () => {
    const expansions = expandSeed("solar panels", ["questions"]);
    expect(expansions).toHaveLength(24);
    expect(expansions[0]).toEqual({
      query: "who solar panels",
      placement: "before",
      modifier: "who",
      seed: "solar panels",
    });
    expect(expansions[1]).toEqual({
      query: "solar panels who",
      placement: "after",
      modifier: "who",
      seed: "solar panels",
    });
  });
});

describe("mineSearchSuggestions", () => {
  it("dedupes suggestions case-insensitively and skips failed queries", async () => {
    mockSuggest({
      "who solar panels": ["Solar Panels Cost", "solar panels cost", "X"],
      "solar panels who": ["Y"],
      "what solar panels": null,
      "solar panels what": ["X", "Z"],
    });
    const { rows, queriesRun } = await mineSearchSuggestions({
      seeds: ["solar panels"],
      hl: "en",
      gl: "au",
      groups: ["questions"],
    });
    expect(queriesRun).toBe(24);
    const keywords = rows.map((row) => row.keyword);
    // Case-insensitive dedupe keeps the first casing seen.
    expect(keywords).toHaveLength(4);
    expect(new Set(keywords)).toEqual(
      new Set(["Solar Panels Cost", "X", "Y", "Z"]),
    );
  });

  it("returns no rows when every query fails", async () => {
    mockSuggest({ "a x": null });
    const { rows } = await mineSearchSuggestions({
      seeds: ["x"],
      hl: "en",
      gl: "au",
      groups: ["letters"],
    });
    expect(rows).toEqual([]);
  });
});
