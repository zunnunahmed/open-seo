import { describe, expect, it, vi } from "vitest";

vi.mock("./aiPick", () => ({ aiPickKeyword: vi.fn() }));

import { aiPickKeyword } from "./aiPick";
import { extractInfoTopics } from "./extractInfoTopics";

const market = { locationCode: 2036, languageCode: "en" };
const organic = (url: string) => ({ type: "organic", url });
const ranked = (keyword: string, volume: number) => ({
  keyword_data: { keyword, keyword_info: { search_volume: volume } },
  ranked_serp_element: { serp_item: { rank_group: 2 } },
});

function memoryKv() {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
  };
}

function fakeClient(pages: Record<string, ReturnType<typeof ranked>[]>) {
  const client = {
    labs: { keywordOverview: vi.fn().mockResolvedValue([]) },
    serp: {
      live: vi
        .fn()
        .mockResolvedValue([
          { type: "ai_overview" },
          organic("https://a.com/1"),
          organic("https://b.com/2"),
          organic("https://c.com/3"),
        ]),
    },
    domain: {
      rankedKeywords: vi.fn(async ({ target }: { target: string }) => ({
        items: pages[target] ?? [],
      })),
    },
  };
  // Only the three methods above are reached.
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  return { client, typed: client as never };
}

describe("extractInfoTopics", () => {
  it("takes a topic that is already searched as it is, with its top result but no page lookup", async () => {
    const { client, typed } = fakeClient({});
    client.labs.keywordOverview.mockResolvedValue([
      { keyword: "carpal tunnel", keyword_info: { search_volume: 900 } },
    ]);

    const [row] = await extractInfoTopics({
      client: typed,
      kv: memoryKv(),
      topics: ["Carpal Tunnel"],
      market,
      acceptExisting: true,
      ai: null,
    });

    expect(row).toMatchObject({
      topic: "Carpal Tunnel",
      infoTopic: "carpal tunnel",
      matchedBy: "existing",
      url: "https://a.com/1",
      aiOverview: true,
    });
    expect(client.domain.rankedKeywords).not.toHaveBeenCalled();
  });

  it("stops at the first page with a matching keyword and reuses cached pages", async () => {
    const { client, typed } = fakeClient({
      "https://a.com/1": [ranked("wrist brace", 5000)],
      "https://b.com/2": [ranked("carpal tunnel exercises at home", 700)],
    });
    const kv = memoryKv();
    const run = () =>
      extractInfoTopics({
        client: typed,
        kv,
        topics: ["carpal tunnel exercises"],
        market,
        acceptExisting: false,
        ai: null,
      });

    const [row] = await run();
    expect(row).toMatchObject({
      infoTopic: "carpal tunnel exercises at home",
      matchedBy: "word",
      urlRank: 2,
      aiOverview: true,
    });
    expect(client.domain.rankedKeywords).toHaveBeenCalledTimes(2);

    await run();
    expect(client.domain.rankedKeywords).toHaveBeenCalledTimes(2);
  });

  it("asks the AI when no keyword shares the topic's words", async () => {
    const { typed } = fakeClient({
      "https://a.com/1": [ranked("cts symptoms", 3000)],
    });
    vi.mocked(aiPickKeyword).mockResolvedValue(0);

    const [row] = await extractInfoTopics({
      client: typed,
      kv: memoryKv(),
      topics: ["signs of carpal tunnel"],
      market,
      acceptExisting: false,
      ai: { apiKey: "key", model: "model" },
    });

    expect(row).toMatchObject({ infoTopic: "cts symptoms", matchedBy: "ai" });
  });

  it("fails when every topic failed", async () => {
    const { client, typed } = fakeClient({});
    client.serp.live.mockRejectedValue(new Error("no credits"));

    await expect(
      extractInfoTopics({
        client: typed,
        kv: memoryKv(),
        topics: ["a topic", "another topic"],
        market,
        acceptExisting: false,
        ai: null,
      }),
    ).rejects.toThrow("no credits");
  });
});
