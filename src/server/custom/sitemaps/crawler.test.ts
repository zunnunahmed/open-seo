import { describe, expect, it, vi } from "vitest";
import { crawlSitemaps, validateSitemapUrl } from "./crawler";

describe("sitemap monitor", () => {
  it("restricts sitemap URLs to HTTPS on the configured project host", () => {
    expect(
      validateSitemapUrl("https://example.com/sitemap.xml", "example.com"),
    ).toBe("https://example.com/sitemap.xml");
    expect(() =>
      validateSitemapUrl("https://other.com/sitemap.xml", "example.com"),
    ).toThrow();
    expect(() =>
      validateSitemapUrl("http://example.com/sitemap.xml", "example.com"),
    ).toThrow();
    // Sites redirect the bare domain to www; both are the project's site.
    expect(
      validateSitemapUrl("https://www.example.com/sitemap.xml", "example.com"),
    ).toBe("https://www.example.com/sitemap.xml");
  });

  it("counts www pages for a bare project domain", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        `<urlset><url><loc>https://www.example.com/a</loc></url><url><loc>https://www.example.com/b</loc></url></urlset>`,
      ),
    );

    const snapshot = await crawlSitemaps(
      "example.com",
      "https://www.example.com/sitemap.xml",
      fetcher,
    );

    expect(snapshot).toMatchObject({ urlCount: 2 });
  });

  it("counts unique URLs across sitemap indexes and flags duplicates", async () => {
    const pages = new Map([
      [
        "https://example.com/sitemap.xml",
        "<sitemapindex><sitemap><loc>https://example.com/a.xml</loc></sitemap><sitemap><loc>https://example.com/b.xml</loc></sitemap></sitemapindex>",
      ],
      [
        "https://example.com/a.xml",
        "<urlset><url><loc>https://example.com/a</loc></url><url><loc>https://example.com/b</loc></url></urlset>",
      ],
      [
        "https://example.com/b.xml",
        "<urlset><url><loc>https://example.com/a</loc></url><url><loc>https://example.com/c</loc></url></urlset>",
      ],
    ]);
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const body = pages.get(
        input instanceof Request
          ? input.url
          : input instanceof URL
            ? input.href
            : input,
      );
      return body
        ? new Response(body, { status: 200 })
        : new Response("", { status: 404 });
    });
    const result = await crawlSitemaps(
      "example.com",
      "https://example.com/sitemap.xml",
      fetcher,
    );
    expect(result.urlCount).toBe(3);
    expect(result.sitemapCount).toBe(3);
    expect(result.duplicateUrls).toBe(1);
    expect(result.complete).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("marks unavailable sitemaps as partial, not zero-page confirmation", async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () => new Response("", { status: 404 }),
    );
    const result = await crawlSitemaps(
      "example.com",
      "https://example.com/sitemap.xml",
      fetcher,
    );
    expect(result.urlCount).toBe(0);
    expect(result.complete).toBe(false);
    expect(result.errors[0]).toContain("HTTP 404");
  });
});
