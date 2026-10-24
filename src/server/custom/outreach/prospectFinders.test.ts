import { describe, expect, it, vi } from "vitest";

vi.mock("./authority", () => ({
  domainAuthority: vi.fn(
    async () =>
      new Map([
        ["bigbrand.com.au", 92],
        ["smallblog.com.au", 24],
      ]),
  ),
}));

import { guestPostProspects, isUnpitchableDomain } from "./prospectFinders";

describe("isUnpitchableDomain", () => {
  it("rejects government sites and giant publishers, not ordinary sites", () => {
    for (const domain of [
      "energy.gov",
      "www.health.gov.au",
      "army.mil",
      "blog.google",
      "www.forbes.com",
      "en.wikipedia.org",
    ])
      expect(isUnpitchableDomain(domain), domain).toBe(true);
    for (const domain of [
      "utahcanna.org",
      "govhealthblog.com",
      "sbecouncil.org",
    ])
      expect(isUnpitchableDomain(domain), domain).toBe(false);
  });
});

describe("guestPostProspects", () => {
  const market = { locationCode: 2036, languageCode: "en" };

  it("keeps the searches that worked when one fails", async () => {
    const live = vi
      .fn()
      .mockRejectedValueOnce(new Error("timed out"))
      .mockResolvedValue([
        { type: "organic", url: "https://blog.site.com.au/write-for-us" },
      ]);
    // Only serp.live is reached.
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    const client = { serp: { live } } as never;

    const prospects = await guestPostProspects(client, ["seo"], market, []);

    expect(prospects.map((p) => p.domain)).toEqual(["blog.site.com.au"]);
    expect(live).toHaveBeenCalledTimes(3);
  });

  it("fails when every search failed", async () => {
    const live = vi.fn().mockRejectedValue(new Error("timed out"));
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    const client = { serp: { live } } as never;

    await expect(
      guestPostProspects(client, ["seo"], market, []),
    ).rejects.toThrow("timed out");
  });

  it("searches local sites, skips advice articles and big brands", async () => {
    const live = vi.fn().mockResolvedValue([
      {
        type: "organic",
        url: "https://smallblog.com.au/write-for-us",
        title: "Write for us",
      },
      {
        type: "organic",
        url: "https://bigbrand.com.au/contribute",
        title: "Become a contributor",
      },
      {
        type: "organic",
        url: "https://advice.com.au/guest-posting",
        title: "How to pitch a guest post",
      },
    ]);
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    const client = { serp: { live } } as never;

    const prospects = await guestPostProspects(client, ["seo"], market, [], {
      endings: ["au"],
      maxAuthority: 60,
    });

    expect(live.mock.calls[0][0].keyword).toContain("site:.au");
    expect(prospects).toEqual([
      expect.objectContaining({ domain: "smallblog.com.au", authority: 24 }),
    ]);
  });

  it("searches several domain endings in one query", async () => {
    const live = vi.fn().mockResolvedValue([]);
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    const client = { serp: { live } } as never;

    await guestPostProspects(client, ["seo"], market, [], {
      endings: ["au", "nz"],
      maxAuthority: 60,
    });

    expect(live.mock.calls[0][0].keyword).toMatch(
      /\(site:\.au OR site:\.nz\)$/,
    );
  });
});
