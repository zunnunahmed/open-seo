import { afterEach, describe, expect, it, vi } from "vitest";
import {
  expandSeed,
  fetchSuggestions,
  mineDataforseoSuggestions,
  mineSearchSuggestions,
} from "@/server/features/keywords/services/searchSuggestions";

vi.mock("@/server/lib/dataforseo", () => ({
  createDataforseoClient: () => ({
    keywords: {
      suggestions: async () => [
        {
          keyword: "Solar Panels Cost",
          keyword_info: {
            search_volume: 1000,
            cpc: 2.5,
            competition: 0.8,
            monthly_searches: [],
          },
          keyword_properties: { keyword_difficulty: 30 },
          search_intent_info: { main_intent: "commercial" },
        },
        {
          keyword: "solar panels cost",
          keyword_info: null,
          keyword_properties: null,
          search_intent_info: null,
        },
        { keyword: null },
      ],
    },
  }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mockFetch(
  handler: (url: URL) => { status: number; body: unknown } | "network-error",
) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const outcome = handler(new URL(String(input)));
    if (outcome === "network-error") throw new Error("fetch failed");
    if (outcome.status !== 200) {
      return new Response("blocked", { status: outcome.status });
    }
    return Response.json(outcome.body);
  });
}

describe("mineDataforseoSuggestions", () => {
  it("maps Labs rows with metrics and dedupes case-insensitively", async () => {
    const { rows, queriesRun, seedsMined } = await mineDataforseoSuggestions({
      seeds: ["solar panels"],
      locationCode: 2840,
      languageCode: "en",
      limitPerSeed: 200,
      billingCustomer: {
        userId: "u",
        userEmail: "u@e.com",
        organizationId: "o",
        projectId: "p",
      },
    });
    expect(queriesRun).toBe(1);
    expect(seedsMined).toEqual(["solar panels"]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      keyword: "solar panels cost",
      searchVolume: 1000,
      cpc: 2.5,
      competition: 0.8,
      keywordDifficulty: 30,
      intent: "commercial",
      seed: "solar panels",
    });
  });
});

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
  it("reports http and network failures without throwing", async () => {
    mockFetch(() => ({ status: 429, body: null }));
    expect(await fetchSuggestions("suggestqueries", "q", "en", "au")).toEqual({
      suggestions: [],
      result: "http 429",
    });
    mockFetch(() => "network-error");
    expect(await fetchSuggestions("www", "q", "en", "au")).toEqual({
      suggestions: [],
      result: "error",
    });
  });
});

describe("mineSearchSuggestions", () => {
  it("mines through suggestqueries when it answers, deduped", async () => {
    mockFetch((url) => {
      if (!url.hostname.includes("suggestqueries")) return { status: 200, body: ["q", []] };
      const q = url.searchParams.get("q");
      if (q === "solar panels") return { status: 200, body: ["q", ["probe hit"]] };
      if (q === "who solar panels")
        return { status: 200, body: ["q", ["Solar Panels Cost", "X"]] };
      if (q === "solar panels what")
        return { status: 200, body: ["q", ["X", "Z"]] };
      return { status: 200, body: ["q", []] };
    });
    const { rows, queriesRun, endpoint, probeLog } =
      await mineSearchSuggestions({
        seeds: ["solar panels"],
        hl: "en",
        gl: "au",
        groups: ["questions"],
      });
    expect(endpoint).toBe("suggestqueries");
    expect(queriesRun).toBe(24);
    expect(new Set(rows.map((r) => r.keyword))).toEqual(
      new Set(["Solar Panels Cost", "X", "Z"]),
    );
    expect(probeLog[0]).toEqual({
      endpoint: "suggestqueries",
      result: "ok",
    });
  });

  it("falls through to the next Google host when the first is rate-limited", async () => {
    mockFetch((url) => {
      if (url.hostname.includes("suggestqueries"))
        return { status: 429, body: null };
      if (url.hostname.includes("www.google"))
        return { status: 200, body: ["q", ["www hit"]] };
      return { status: 200, body: ["q", []] };
    });
    const { rows, endpoint, probeLog } = await mineSearchSuggestions({
      seeds: ["solar panels"],
      hl: "en",
      gl: "au",
      groups: ["questions"],
    });
    expect(endpoint).toBe("www");
    expect(rows.map((r) => r.keyword)).toEqual(["www hit"]);
    expect(probeLog).toEqual([
      { endpoint: "suggestqueries", result: "http 429" },
      { endpoint: "www", result: "ok" },
    ]);
  });

  it("reports every probe result when no Google host answers", async () => {
    mockFetch((url) => {
      if (url.hostname.includes("suggestqueries")) return { status: 403, body: null };
      if (url.hostname.includes("www.google")) return { status: 200, body: ["q", []] };
      return "network-error";
    });
    const { rows, endpoint, probeLog } = await mineSearchSuggestions({
      seeds: ["x"],
      hl: "en",
      gl: "au",
      groups: ["letters"],
    });
    expect(rows).toEqual([]);
    expect(endpoint).toBeNull();
    expect(probeLog).toEqual([
      { endpoint: "suggestqueries", result: "http 403" },
      { endpoint: "www", result: "empty" },
      { endpoint: "toolbar", result: "error" },
    ]);
  });
});
