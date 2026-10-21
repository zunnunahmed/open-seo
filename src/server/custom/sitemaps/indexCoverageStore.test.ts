import { describe, expect, it, vi } from "vitest";
import { GscApiError } from "@/server/lib/gscErrors";
import {
  classifyInspection,
  DAILY_LIMIT,
  inspectBatch,
  pickBatch,
  readResults,
  readState,
  saveSitemapUrls,
  summarizeCoverage,
} from "./indexCoverageStore";

function fakeKv() {
  const store = new Map<string, string>();
  return {
    store,
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
  };
}

const now = new Date("2026-10-22T10:00:00Z");
const pass = {
  indexStatusResult: {
    verdict: "PASS",
    coverageState: "Submitted and indexed",
    lastCrawlTime: "2026-10-01T00:00:00Z",
  },
};
const neutral = {
  indexStatusResult: {
    verdict: "NEUTRAL",
    coverageState: "Crawled - currently not indexed",
  },
};

describe("index coverage", () => {
  it("classifies PASS as indexed and keeps Google's reason otherwise", () => {
    expect(classifyInspection(pass, now)).toMatchObject({
      i: true,
      c: "2026-10-01T00:00:00Z",
    });
    expect(classifyInspection(neutral, now)).toMatchObject({
      i: false,
      r: "Crawled - currently not indexed",
    });
    expect(classifyInspection(null, now).i).toBe(false);
  });

  it("picks unchecked URLs first, then only stale re-checks", () => {
    const fresh = { i: true, r: "x", t: now.toISOString() };
    const old = { i: false, r: "x", t: "2026-10-01T00:00:00Z" };
    const results = { "https://a.com/1": fresh, "https://a.com/2": old };
    const urls = ["https://a.com/1", "https://a.com/2", "https://a.com/3"];
    expect(pickBatch(urls, results, 5, now)).toEqual([
      "https://a.com/3",
      "https://a.com/2",
    ]);
    expect(pickBatch(urls, results, 0, now)).toEqual([]);
  });

  it("summarizes counts and not-indexed reasons", () => {
    const summary = summarizeCoverage(["a", "b", "c", "d"], {
      a: { i: true, r: "ok", t: "" },
      b: { i: false, r: "Excluded by noindex", t: "" },
      c: { i: null, r: "Inspection failed", t: "" },
    });
    expect(summary).toMatchObject({
      totalUrls: 4,
      indexed: 1,
      notIndexed: 1,
      failed: 1,
      notChecked: 1,
      reasons: [{ reason: "Excluded by noindex", count: 1 }],
    });
  });

  it("inspects a batch, stores results and counts daily usage", async () => {
    const kv = fakeKv();
    await saveSitemapUrls(kv, "p1", ["https://a.com/1", "https://a.com/2"]);
    const inspect = vi.fn(async (url: string) =>
      url.endsWith("1") ? pass : neutral,
    );
    const outcome = await inspectBatch(kv, "p1", 20, inspect, now);
    expect(outcome).toEqual({ inspected: 2, rateLimited: false, error: null });
    const results = await readResults(kv, "p1");
    expect(results["https://a.com/1"].i).toBe(true);
    expect(results["https://a.com/2"].i).toBe(false);
    expect((await readState(kv, "p1", now)).used).toBe(2);
    // Everything is fresh, so a second run inspects nothing.
    expect((await inspectBatch(kv, "p1", 20, inspect, now)).inspected).toBe(0);
  });

  it("respects the daily limit and resets it the next day", async () => {
    const kv = fakeKv();
    await saveSitemapUrls(kv, "p1", ["https://a.com/1"]);
    kv.store.set(
      "custom:sitemaps:index-state:p1",
      JSON.stringify({
        day: "2026-10-22",
        used: DAILY_LIMIT,
        lastRunAt: null,
        lastError: null,
      }),
    );
    const inspect = vi.fn(async () => pass);
    expect((await inspectBatch(kv, "p1", 20, inspect, now)).inspected).toBe(0);
    const tomorrow = new Date("2026-10-23T01:00:00Z");
    expect(
      (await inspectBatch(kv, "p1", 20, inspect, tomorrow)).inspected,
    ).toBe(1);
  });

  it("stops on rate limits and records per-URL failures", async () => {
    const kv = fakeKv();
    await saveSitemapUrls(kv, "p1", ["https://a.com/1", "https://a.com/2"]);
    const limited = await inspectBatch(
      kv,
      "p1",
      20,
      async () => {
        throw new GscApiError(429, "rate limited", "");
      },
      now,
    );
    expect(limited.rateLimited).toBe(true);
    expect(limited.error).toMatch(/rate limit/);

    const kv2 = fakeKv();
    await saveSitemapUrls(kv2, "p1", ["https://a.com/1"]);
    await inspectBatch(
      kv2,
      "p1",
      20,
      async () => {
        throw new GscApiError(400, "bad url", "");
      },
      now,
    );
    expect((await readResults(kv2, "p1"))["https://a.com/1"]).toMatchObject({
      i: null,
      r: "Inspection failed (HTTP 400)",
    });
  });

  it("drops results for URLs no longer in the sitemap", async () => {
    const kv = fakeKv();
    await saveSitemapUrls(kv, "p1", ["https://a.com/1", "https://a.com/2"]);
    await inspectBatch(kv, "p1", 20, async () => pass, now);
    await saveSitemapUrls(kv, "p1", ["https://a.com/2"]);
    expect(Object.keys(await readResults(kv, "p1"))).toEqual([
      "https://a.com/2",
    ]);
  });
});
