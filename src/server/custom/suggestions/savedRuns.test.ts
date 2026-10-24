import { describe, expect, it } from "vitest";
import {
  deleteSavedRun,
  getSavedRun,
  listSavedRuns,
  saveRun,
  updateRun,
  type SavedRunsKv,
} from "./savedRuns";

function fakeKv() {
  const store = new Map<string, { value: string; ttl?: number }>();
  const kv: SavedRunsKv = {
    get: async (key) => store.get(key)?.value ?? null,
    put: async (key, value, options) => {
      store.set(key, { value, ttl: options?.expirationTtl });
    },
    delete: async (key) => {
      store.delete(key);
    },
  };
  return { kv, store };
}

const input = {
  name: "dental laboratory · Australia",
  result: {
    mode: "free" as const,
    countryName: "Australia",
    queriesRun: 98,
    rows: [
      {
        keyword: "a dental lab near me",
        placement: "before" as const,
        modifier: "a",
        seed: "dental laboratory",
        query: "a dental laboratory",
      },
    ],
  },
};

const row = {
  topic: "carpal tunnel",
  infoTopic: "carpal tunnel",
  volume: 900,
  difficulty: null,
  cpc: null,
  intent: null,
  matchedBy: "existing" as const,
  urlRank: null,
  url: null,
  position: null,
  aiOverview: null,
};
const info = (rows: (typeof row)[]) => ({
  name: "2 info topics · Australia",
  result: {
    mode: "info" as const,
    countryName: "Australia",
    rows,
    topics: ["carpal tunnel", "wrist pain"],
    settings: {
      locationCode: 2036,
      languageCode: "en",
      acceptExisting: true,
      useAi: false,
    },
  },
});

describe("saved suggestion runs", () => {
  it("stores a run that Cloudflare deletes after 28 days", async () => {
    const { kv, store } = fakeKv();
    const now = new Date("2026-10-23T00:00:00Z");

    const meta = await saveRun(kv, "p1", input, now);

    expect(meta).toMatchObject({
      keywordCount: 1,
      expiresAt: "2026-11-20T00:00:00.000Z",
    });
    expect([...store.values()].map((entry) => entry.ttl)).toEqual([
      28 * 24 * 60 * 60,
      28 * 24 * 60 * 60,
    ]);
    expect(await getSavedRun(kv, "p1", meta.id)).toMatchObject(input);
  });

  it("lists only runs that have not expired, and deletes on request", async () => {
    const { kv } = fakeKv();
    await saveRun(kv, "p1", input, new Date("2026-09-01"));
    const fresh = await saveRun(kv, "p1", input, new Date("2026-10-20"));
    const now = new Date("2026-10-23");

    expect((await listSavedRuns(kv, "p1", now)).map((run) => run.id)).toEqual([
      fresh.id,
    ]);

    await deleteSavedRun(kv, "p1", fresh.id, now);
    expect(await listSavedRuns(kv, "p1", now)).toEqual([]);
    expect(await getSavedRun(kv, "p1", fresh.id)).toBeNull();
  });

  it("saves a running Info topics run's progress over the same run", async () => {
    const { kv } = fakeKv();
    const meta = await saveRun(kv, "p1", info([]));
    await updateRun(kv, "p1", meta.id, info([row]));

    expect(await getSavedRun(kv, "p1", meta.id)).toMatchObject({
      result: { rows: [row], topics: ["carpal tunnel", "wrist pain"] },
    });
    expect(await listSavedRuns(kv, "p1")).toEqual([
      expect.objectContaining({ id: meta.id, keywordCount: 1 }),
    ]);
  });
});
