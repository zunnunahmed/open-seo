import { afterEach, describe, expect, it, vi } from "vitest";
import {
  expandSeed,
  fetchSuggestions,
  mineSearchSuggestions,
} from "@/server/features/keywords/services/searchSuggestions";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mockFetch(handler: (url: string) => unknown) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const outcome = handler(String(input));
    if (outcome === "network-error") throw new Error("fetch failed");
    if (typeof outcome === "number") {
      return new Response("blocked", { status: outcome });
    }
    return Response.json(outcome);
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

describe("fetchSuggestions parsers", () => {
  it("reads Google firefox and Yahoo fxjson responses", async () => {
    mockFetch(() => ["q", ["a", "b"]]);
    expect(
      (await fetchSuggestions("google", "q", "en", "au")).suggestions,
    ).toEqual(["a", "b"]);
    expect(
      (await fetchSuggestions("yahoo", "q", "en", "au")).suggestions,
    ).toEqual(["a", "b"]);
  });

  it("reads DuckDuckGo phrase responses", async () => {
    mockFetch(() => [{ phrase: "a" }, { phrase: "" }, { nope: 1 }]);
    const { suggestions, result } = await fetchSuggestions(
      "duckduckgo",
      "q",
      "en",
      "au",
    );
    expect(suggestions).toEqual(["a"]);
    expect(result).toBe("ok");
  });

  it("reports http and network failures without throwing", async () => {
    mockFetch(() => 429);
    expect(await fetchSuggestions("google", "q", "en", "au")).toEqual({
      suggestions: [],
      result: "http 429",
    });
    mockFetch(() => "network-error");
    expect(await fetchSuggestions("google", "q", "en", "au")).toEqual({
      suggestions: [],
      result: "error",
    });
  });
});

describe("mineSearchSuggestions", () => {
  it("mines through Google when it answers and dedupes case-insensitively", async () => {
    mockFetch((url) => {
      const parsed = new URL(url);
      if (!parsed.hostname.includes("google")) return ["q", []];
      const q = parsed.searchParams.get("q");
      if (q === "solar panels") return ["q", ["probe hit"]];
      if (q === "who solar panels") return ["q", ["Solar Panels Cost", "X"]];
      if (q === "solar panels what") return ["q", ["X", "Z"]];
      return ["q", []];
    });
    const { rows, queriesRun, source, probeLog } =
      await mineSearchSuggestions({
        seeds: ["solar panels"],
        hl: "en",
        gl: "au",
        groups: ["questions"],
      });
    expect(source).toBe("google");
    expect(queriesRun).toBe(24);
    expect(new Set(rows.map((r) => r.keyword))).toEqual(
      new Set(["Solar Panels Cost", "X", "Z"]),
    );
    expect(probeLog[0]).toEqual({ source: "google", result: "ok" });
  });

  it("falls back to DuckDuckGo when Google is rate-limited", async () => {
    mockFetch((url) => {
      if (url.includes("suggestqueries.google.com")) return 429;
      if (url.includes("duckduckgo.com")) return [{ phrase: "ddg hit" }];
      return [];
    });
    const { rows, source, probeLog } = await mineSearchSuggestions({
      seeds: ["solar panels"],
      hl: "en",
      gl: "au",
      groups: ["questions"],
    });
    expect(source).toBe("duckduckgo");
    expect(rows.map((r) => r.keyword)).toEqual(["ddg hit"]);
    expect(probeLog).toEqual([
      { source: "google", result: "http 429" },
      { source: "duckduckgo", result: "ok" },
    ]);
  });

  it("reports every probe result when no provider answers", async () => {
    mockFetch((url) => {
      if (url.includes("duckduckgo.com")) return [];
      if (url.includes("yahoo.com")) return "network-error";
      return 403;
    });
    const { rows, source, probeLog } = await mineSearchSuggestions({
      seeds: ["x"],
      hl: "en",
      gl: "au",
      groups: ["letters"],
    });
    expect(rows).toEqual([]);
    expect(source).toBeNull();
    expect(probeLog).toEqual([
      { source: "google", result: "http 403" },
      { source: "duckduckgo", result: "empty" },
      { source: "yahoo", result: "error" },
    ]);
  });
});
