import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("@/server/lib/runtime-env", () => ({
  getRequiredEnvValue: vi.fn(async () => "unused"),
  getOptionalEnvValue: vi.fn(async (name: string) =>
    name === "CUSTOM_TREG_ENABLED" ? "true" : "treg-token",
  ),
}));

import { runWithSeoProviderRoute } from "@/server/custom/providers/treg/dataforseoTransport";
import { fetchRankedKeywords } from "@/server/lib/dataforseo/labs";
import { fetchLiveSerp } from "@/server/lib/dataforseo/serp";

afterEach(() => {
  vi.unstubAllGlobals();
});

function serpstatReturns(body: unknown) {
  const fetchMock = vi.fn<typeof fetch>(async () => Response.json(body));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function sentParams(fetchMock: ReturnType<typeof serpstatReturns>) {
  const body = fetchMock.mock.calls[0][1]?.body;
  return z
    .object({ params: z.record(z.string(), z.unknown()) })
    .parse(JSON.parse(typeof body === "string" ? body : "{}")).params;
}

const serpstat = <T>(fn: () => Promise<T>) =>
  runWithSeoProviderRoute("treg_serpstat", fn);

describe("treg → Serpstat as DataForSEO", () => {
  it("answers a live SERP with Serpstat's top results and features", async () => {
    const fetchMock = serpstatReturns({
      result: {
        data: {
          top: [
            {
              position: 1,
              url: "https://www.a.com/x",
              domain: "a.com",
              subdomain: "www.a.com",
            },
          ],
          types: ["also_asks", "snip_breadcrumbs"],
        },
      },
    });

    const { data } = await serpstat(() =>
      fetchLiveSerp({
        keyword: "coffee",
        locationCode: 2036,
        languageCode: "en",
      }),
    );

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://treg.to/call/serpstat.google.serp.organic",
    );
    expect(sentParams(fetchMock)).toMatchObject({ se: "g_au" });
    expect(data).toMatchObject([
      {
        type: "organic",
        rank_group: 1,
        domain: "www.a.com",
        url: "https://www.a.com/x",
      },
      { type: "people_also_ask" },
    ]);
  });

  it("treats Serpstat's not-found error as an empty result", async () => {
    serpstatReturns({ error: { code: -32000, message: "SERP not found" } });

    const { data } = await serpstat(() =>
      fetchLiveSerp({ keyword: "x", locationCode: 2840, languageCode: "en" }),
    );

    expect(data).toEqual([]);
  });

  it.each([
    ["a mobile SERP", { device: "mobile" as const }],
    ["a city SERP", { locationName: "Sydney,New South Wales,Australia" }],
  ])("refuses %s rather than answering with other data", async (_, input) => {
    const fetchMock = serpstatReturns({});

    await expect(
      serpstat(() =>
        fetchLiveSerp({
          keyword: "x",
          locationCode: 2036,
          languageCode: "en",
          ...input,
        }),
      ),
    ).rejects.toMatchObject({ code: "PROVIDER_ROUTE_UNSUPPORTED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps a domain-scoped ranked keywords page and refuses column filters", async () => {
    const fetchMock = serpstatReturns({
      result: {
        data: [
          {
            keyword: "nespresso machine",
            url: "https://www.nespresso.com/m",
            position: 2,
            region_queries_count: 246000,
            traff: 36881,
            difficulty: 51,
          },
        ],
        summary_info: { total: 104005 },
      },
    });
    const hostPin = [
      "ranked_serp_element.serp_item.domain",
      "in",
      ["nespresso.com", "www.nespresso.com"],
    ];
    const request = {
      target: "nespresso.com",
      locationCode: 2840,
      languageCode: "en",
      limit: 50,
      offset: 50,
      orderBy: ["keyword_data.keyword_info.search_volume,desc"],
    };

    const { data } = await serpstat(() =>
      fetchRankedKeywords({ ...request, filters: [hostPin] }),
    );

    expect(sentParams(fetchMock)).toMatchObject({
      domain: "nespresso.com",
      se: "g_us",
      withSubdomains: false,
      sort: { region_queries_count: "desc" },
      page: 2,
      size: 50,
    });
    expect(data.totalCount).toBe(104005);
    expect(data.items[0]).toMatchObject({
      keyword_data: {
        keyword: "nespresso machine",
        keyword_info: { search_volume: 246000 },
        keyword_properties: { keyword_difficulty: 51 },
      },
      ranked_serp_element: { serp_item: { rank_absolute: 2, etv: 36881 } },
    });

    await expect(
      serpstat(() =>
        fetchRankedKeywords({
          ...request,
          filters: [
            hostPin,
            "and",
            ["keyword_data.keyword_info.search_volume", ">=", 100],
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: "PROVIDER_ROUTE_UNSUPPORTED" });
  });
});
