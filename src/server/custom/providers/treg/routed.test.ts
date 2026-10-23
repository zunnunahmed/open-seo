import { describe, expect, it, vi } from "vitest";
import {
  aggregateReferringDomains,
  callTregRouted,
  parseRoutedBacklinkRow,
  parseRoutedBacklinks,
  parseRoutedSummary,
} from "./routed";

function okResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe("callTregRouted", () => {
  it("sends the prefer header with waterfall disabled and returns served-by", async () => {
    const request = vi.fn<typeof fetch>(async () =>
      okResponse({
        output: { summary: { backlinks: 10, referring_domains: 3 } },
        _treg: {
          served_by: "dataforseo.web.backlinks.summary",
          tried: [{ endpoint_id: "dataforseo.web.backlinks.summary", charged_micro: 24036 }],
        },
      }),
    );
    const result = await callTregRouted(
      "treg.web.backlinks.summary",
      { target: "example.com" },
      { token: "secret", prefer: "dataforseo", fetchImpl: request },
    );
    expect(request).toHaveBeenCalledTimes(1);
    const [url, init] = request.mock.calls[0] ?? [];
    expect(url).toBe("https://treg.to/call/treg.web.backlinks.summary");
    expect(new Headers(init?.headers).get("X-Treg-Token")).toBe("secret");
    expect(new Headers(init?.headers).get("X-Treg-Route-Prefer")).toBe("dataforseo");
    expect(new Headers(init?.headers).get("X-Treg-Route-Waterfall")).toBe("0");
    const rawBody = init?.body;
    expect(typeof rawBody === "string" ? JSON.parse(rawBody) : null).toEqual({
      target: "example.com",
    });
    expect(result).toMatchObject({
      servedBy: "dataforseo.web.backlinks.summary",
      chargedUsd: 0.024036,
    });
  });

  it("throws on HTTP errors and provider errors without retrying", async () => {
    const denied = vi.fn<typeof fetch>(
      async () => new Response("denied", { status: 429 }),
    );
    await expect(
      callTregRouted("treg.web.backlinks.summary", {}, { token: "t", prefer: "dataforseo", fetchImpl: denied }),
    ).rejects.toThrow("HTTP 429");
    expect(denied).toHaveBeenCalledTimes(1);

    const providerError = vi.fn<typeof fetch>(async () =>
      okResponse({ error: { code: 1 }, output: null }),
    );
    await expect(
      callTregRouted("treg.web.backlinks.summary", {}, { token: "t", prefer: "dataforseo", fetchImpl: providerError }),
    ).rejects.toThrow("treg provider returned an error");
  });
});

describe("parseRoutedSummary", () => {
  it("reads the DataForSEO summary shape", () => {    expect(
      parseRoutedSummary({
        summary: {
          target: "example.com",
          backlinks: 28221,
          referring_domains: 946,
        },
      }),
    ).toEqual({ backlinks: 28221, referringDomains: 946 });
  });

  it("falls back to top-level counts and never invents numbers", () => {
    expect(parseRoutedSummary({ backlinks: 3705, referring_domains: 177 })).toEqual({
      backlinks: 3705,
      referringDomains: 177,
    });
    expect(parseRoutedSummary({ summary: null, backlinks: null })).toEqual({
      backlinks: null,
      referringDomains: null,
    });
    expect(parseRoutedSummary({})).toEqual({ backlinks: null, referringDomains: null });
    expect(parseRoutedSummary(null)).toEqual({ backlinks: null, referringDomains: null });
    expect(parseRoutedSummary({ summary: { backlinks: -5, referring_domains: "lots" } })).toEqual({
      backlinks: null,
      referringDomains: null,
    });
  });
});

describe("parseRoutedBacklinkRow", () => {
  const base = {
    url_from: "https://example.org/post",
    url_to: "https://target.com/",
    anchor: "Example",
    first_seen: "2026-08-12 19:21:42 +00:00",
    domain_inlink_rank: 26,
  };
  it("maps dofollow/nofollow explicitly and keeps nulls null", () => {
    expect(parseRoutedBacklinkRow({ ...base, dofollow: true })).toMatchObject({
      source: "https://example.org/post",
      target: "https://target.com/",
      anchor: "Example",
      linkType: "dofollow",
      firstSeen: "2026-08-12 19:21:42 +00:00",
      authority: 26,
    });
    expect(parseRoutedBacklinkRow({ ...base, dofollow: false })?.linkType).toBe("nofollow");
    expect(parseRoutedBacklinkRow({ ...base, dofollow: undefined })?.linkType).toBeNull();
  });

  it("drops rows without a source URL", () => {
    expect(parseRoutedBacklinkRow({ url_from: 42 })).toBeNull();
    expect(parseRoutedBacklinkRow(null)).toBeNull();
    expect(parseRoutedBacklinkRow("https://example.com")).toBeNull();
  });

  it("collects only usable rows from a list response", () => {
    expect(
      parseRoutedBacklinks({
        backlinks: [
          { url_from: "https://example.org/post", dofollow: true },
          { url_from: 42 },
        ],
      }),
    ).toHaveLength(1);
    expect(parseRoutedBacklinks({ backlinks: null })).toEqual([]);
    expect(parseRoutedBacklinks(null)).toEqual([]);
  });
});

describe("aggregateReferringDomains", () => {
  const rows = [
    { source: "https://a.com/1", target: null, anchor: null, linkType: null, firstSeen: null, authority: 10 },
    { source: "https://a.com/2", target: null, anchor: null, linkType: null, firstSeen: null, authority: 30 },
    { source: "https://b.com/", target: null, anchor: null, linkType: null, firstSeen: null, authority: null },
    { source: "not a url", target: null, anchor: null, linkType: null, firstSeen: null, authority: 99 },
  ];
  it("dedupes by domain, counts links, keeps the best authority", () => {
    expect(aggregateReferringDomains(rows, 20)).toEqual([
      { domain: "a.com", linkCount: 2, authority: 30 },
      { domain: "b.com", linkCount: 1, authority: null },
    ]);
  });
  it("respects the limit", () => {
    expect(aggregateReferringDomains(rows, 1)).toHaveLength(1);
  });
});
