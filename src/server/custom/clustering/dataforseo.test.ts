import { describe, expect, it } from "vitest";
import { extractClusterSerp } from "./dataforseo";

describe("extractClusterSerp", () => {
  it("keeps top-10 organic URLs in rank order and lists SERP features", () => {
    const items = [
      { type: "local_pack", rank_group: 1 },
      { type: "organic", rank_group: 2, url: "https://www.b.com/page/" },
      { type: "organic", rank_group: 1, url: "https://a.com/?ref=x" },
      { type: "people_also_ask", rank_group: 1 },
      // Same page twice (sitelink-style duplicate) counts once.
      { type: "organic", rank_group: 3, url: "http://b.com/page" },
      { type: "organic", rank_group: 4, url: "not a url" },
      "garbage",
      ...Array.from({ length: 12 }, (_, i) => ({
        type: "organic",
        rank_group: 10 + i,
        url: `https://c.com/${i}`,
      })),
    ];
    const serp = extractClusterSerp(items);
    expect(serp.urls.slice(0, 3)).toEqual(["a.com", "b.com/page", "c.com/0"]);
    expect(serp.urls).toHaveLength(10);
    expect(serp.features).toEqual(["local_pack", "people_also_ask"]);
  });

  it("handles a missing item list", () => {
    expect(extractClusterSerp(null)).toEqual({ urls: [], features: [] });
  });
});
