import { describe, expect, it } from "vitest";
import {
  cleanKeywordList,
  clusterKeywords,
  isDomainOrSubdomain,
  normalizeSerpUrl,
  pageTypeForUrl,
  parseKeywordCsvRows,
  parseKeywordLines,
  type ClusterableKeyword,
} from "./keywordClustering";
import { groupTopicHubs } from "./keywordClusterHubs";

function kw(
  keyword: string,
  volume: number | null,
  urls: string[],
  features: string[] = [],
): ClusterableKeyword {
  return { keyword, volume, cpc: null, urls, features };
}

const u = (...ids: number[]) => ids.map((id) => `site${id}.com/page`);

describe("keyword clustering helpers", () => {
  it("normalizes URLs so the same page matches across SERPs", () => {
    expect(normalizeSerpUrl("https://www.Example.com/a/?utm=1#x")).toBe(
      "example.com/a",
    );
    expect(normalizeSerpUrl("http://example.com/")).toBe("example.com");
    expect(normalizeSerpUrl("ftp://example.com/a")).toBeNull();
    expect(normalizeSerpUrl("not a url")).toBeNull();
  });

  it("cleans, de-duplicates and keeps the first metrics", () => {
    const result = cleanKeywordList([
      { keyword: "  Blocked  Drain ", volume: 100, cpc: 2 },
      { keyword: "blocked drain", volume: 5, cpc: null },
      { keyword: "", volume: null, cpc: null },
      { keyword: "x".repeat(81), volume: null, cpc: null },
    ]);
    expect(result.keywords).toEqual([
      { keyword: "blocked drain", volume: 100, cpc: 2 },
    ]);
    expect(result.duplicates).toBe(1);
    expect(result.invalid).toBe(1);
  });

  it("parses pasted spreadsheet rows and CSV headers", () => {
    expect(
      parseKeywordLines("plumber sydney\t1,900\t$4.50\nhot water"),
    ).toEqual([
      { keyword: "plumber sydney", volume: 1900, cpc: 4.5 },
      { keyword: "hot water", volume: null, cpc: null },
    ]);
    expect(
      parseKeywordCsvRows([{ Query: "a", "Search Volume": "10", CPC: "1.2" }]),
    ).toEqual([{ keyword: "a", volume: 10, cpc: 1.2 }]);
  });

  it("guesses page types from URL paths", () => {
    expect(pageTypeForUrl("a.com")).toBe("Homepage");
    expect(pageTypeForUrl("a.com/blog/how-to-fix")).toBe("Article");
    expect(pageTypeForUrl("a.com/products/widget")).toBe("Product");
    expect(pageTypeForUrl("a.com/collections/widgets")).toBe("Category");
    expect(pageTypeForUrl("a.com/services/plumbing")).toBe("Service");
    expect(pageTypeForUrl("a.com/about")).toBe("Other");
  });

  it("matches domains and subdomains only", () => {
    expect(isDomainOrSubdomain("shop.example.com", "www.example.com")).toBe(
      true,
    );
    expect(isDomainOrSubdomain("notexample.com", "example.com")).toBe(false);
  });
});

describe("clusterKeywords", () => {
  // a, b, c share 4 URLs with a; c shares only 2 with b. d is unrelated.
  const items = [
    kw("b", 50, u(1, 2, 3, 4, 7, 8)),
    kw("a", 100, u(1, 2, 3, 4, 5, 6)),
    kw("c", 10, u(1, 2, 5, 6, 9, 10)),
    kw("d", 500, u(20, 21, 22)),
  ];

  it("soft mode joins keywords to the highest-volume main keyword", () => {
    const clusters = clusterKeywords(items, {
      threshold: 4,
      mode: "soft",
      primaryBy: "volume",
    });
    const abc = clusters.find((c) => c.main.keyword === "a");
    expect(abc?.keywords.map((k) => k.keyword)).toEqual(["a", "b", "c"]);
    expect(abc?.totalVolume).toBe(160);
    expect(clusters[0].main.keyword).toBe("d");
  });

  it("strict mode requires overlap with every member", () => {
    const clusters = clusterKeywords(items, {
      threshold: 4,
      mode: "strict",
      primaryBy: "volume",
    });
    const groups = clusters.map((c) => c.keywords.map((k) => k.keyword));
    expect(groups).toContainEqual(["a", "b"]);
    expect(groups).toContainEqual(["c"]);
  });

  it("reports shared URLs, your pages and cannibalization", () => {
    const [cluster] = clusterKeywords(
      [
        kw(
          "x",
          10,
          ["mine.com/a", "mine.com/b", ...u(1, 2, 3)],
          ["local_pack"],
        ),
        kw("y", 5, ["mine.com/a", ...u(1, 2, 3, 4)], ["local_pack"]),
      ],
      {
        threshold: 3,
        mode: "balanced",
        primaryBy: "volume",
        ownDomain: "mine.com",
      },
    );
    expect(cluster.keywords).toHaveLength(2);
    expect(cluster.sharedUrls).toEqual([
      "mine.com/a",
      "site1.com/page",
      "site2.com/page",
      "site3.com/page",
    ]);
    expect(cluster.ownUrls).toEqual(["mine.com/a", "mine.com/b"]);
    expect(cluster.features).toEqual(["local_pack"]);
  });

  it("orders main keywords by CPC when asked", () => {
    const [cluster] = clusterKeywords(
      [
        {
          keyword: "cheap",
          volume: 1000,
          cpc: 1,
          urls: u(1, 2, 3),
          features: [],
        },
        {
          keyword: "pricey",
          volume: 10,
          cpc: 9,
          urls: u(1, 2, 3),
          features: [],
        },
      ],
      { threshold: 3, mode: "soft", primaryBy: "cpc" },
    );
    expect(cluster.main.keyword).toBe("pricey");
  });
});

const groups = (clusters: ReturnType<typeof clusterKeywords>) =>
  clusters.map((c) => c.keywords.map((k) => k.keyword));

describe("clustering options", () => {
  const options = {
    threshold: 3,
    mode: "balanced",
    primaryBy: "volume",
  } as const;

  it("ignores directory and social URLs when asked", () => {
    const shared = ["clutch.co/au", "www.yelp.com/x", "facebook.com/y"];
    const items = [
      kw("seo sydney", 20, [...shared, ...u(1)]),
      kw("plumber sydney", 10, [...shared, ...u(2)]),
    ];
    expect(groups(clusterKeywords(items, options))).toContainEqual([
      "seo sydney",
      "plumber sydney",
    ]);
    expect(
      groups(clusterKeywords(items, { ...options, ignorePlatforms: true })),
    ).toEqual([["seo sydney"], ["plumber sydney"]]);
  });

  it("counts shared top-3 results more when weighting is on", () => {
    // Two shared URLs, both at the top: 2 unweighted, 3 weighted.
    const items = [
      kw("a", 20, [...u(1, 2), ...u(3, 4)]),
      kw("b", 10, [...u(1, 2), ...u(5, 6)]),
    ];
    expect(groups(clusterKeywords(items, options))).toHaveLength(2);
    expect(
      groups(clusterKeywords(items, { ...options, weightTop: true })),
    ).toEqual([["a", "b"]]);
  });
});

describe("groupTopicHubs", () => {
  it("joins clusters whose core pages overlap and leaves others out", () => {
    const clusters = clusterKeywords(
      [
        kw("a1", 100, u(1, 2, 3, 4, 5, 6)),
        kw("a2", 90, u(1, 2, 3, 4, 5, 6)),
        kw("b1", 50, u(1, 2, 3, 7, 8, 9)),
        kw("b2", 40, u(1, 2, 3, 7, 8, 9)),
        kw("c1", 30, u(20, 21, 22, 23)),
        kw("c2", 20, u(20, 21, 22, 23)),
      ],
      { threshold: 4, mode: "strict", primaryBy: "volume" },
    );
    const hubs = groupTopicHubs(clusters, { ignorePlatforms: false });
    expect(hubs).toHaveLength(1);
    expect(hubs[0].name).toBe("a1");
    expect(hubs[0].clusterIds).toHaveLength(2);
    expect(hubs[0].totalVolume).toBe(280);
  });
});
