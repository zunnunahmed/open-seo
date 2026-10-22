import { afterEach, describe, expect, it, vi } from "vitest";
import {
  expandSeed,
  fetchSuggestions,
  mineDataforseoSuggestions,
  mineSearchSuggestions,
} from "@/server/features/keywords/services/searchSuggestions";

let overviewShouldFail = false;

vi.mock("@/server/lib/dataforseo", () => ({
  createDataforseoClient: () => ({
    serp: {
      autocomplete: async ({ keyword }: { keyword: string }) =>
        keyword === "who solar panels"
          ? ["Solar Panels Cost", "X"]
          : keyword === "solar panels what"
            ? ["X", "Z"]
            : [],
    },
    labs: {
      keywordOverview: async () => {
        if (overviewShouldFail) throw new Error("UPSTREAM_UNAVAILABLE");
        return [
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
          keyword: "x",
          keyword_info: null,
          keyword_properties: null,
          search_intent_info: null,
        },
      ];
      },
    },
  }),
}));

vi.mock("@/server/lib/r2-cache", () => ({
  buildCacheKey: (...parts: unknown[]) => Promise.resolve(parts.join("|")),
  getCached: () => Promise.resolve(null),
  setCached: () => Promise.resolve(),
  CACHE_TTL: { researchResult: 86400 },
}));

vi.mock("cloudflare:workers", () => ({}));

afterEach(() => {
  overviewShouldFail = false;
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
  it("mines autocomplete expansions and enriches them with overview metrics", async () => {
    const { rows, queriesRun, seedsMined, metricsError } =
      await mineDataforseoSuggestions({
      seeds: ["solar panels"],
      locationCode: 2840,
      languageCode: "en",
      groups: ["questions"],
      billingCustomer: {
        userId: "u",
        userEmail: "u@e.com",
        organizationId: "o",
        projectId: "p",
      },
    });
    expect(queriesRun).toBe(24);
    expect(seedsMined).toEqual(["solar panels"]);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      keyword: "Solar Panels Cost",
      placement: "before",
      modifier: "who",
      seed: "solar panels",
      searchVolume: 1000,
      cpc: 2.5,
      competition: 0.8,
      keywordDifficulty: 30,
      intent: "commercial",
    });
    expect(rows.map((row) => row.keyword)).toEqual([
      "Solar Panels Cost",
      "X",
      "Z",
    ]);
    expect(metricsError).toBeNull();
  });

  it("still returns autocomplete rows when the overview lookup fails", async () => {
    overviewShouldFail = true;
    const { rows, seedsMined, metricsError } = await mineDataforseoSuggestions({
      seeds: ["solar panels"],
      locationCode: 2840,
      languageCode: "en",
      groups: ["questions"],
      billingCustomer: {
        userId: "u",
        userEmail: "u@e.com",
        organizationId: "o",
        projectId: "p",
      },
    });
    expect(seedsMined).toEqual(["solar panels"]);
    expect(rows.map((row) => row.keyword)).toEqual([
      "Solar Panels Cost",
      "X",
      "Z",
    ]);
    expect(rows.every((row) => row.searchVolume === null)).toBe(true);
    expect(typeof metricsError).toBe("string");
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
