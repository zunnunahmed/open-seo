import { describe, expect, it, vi } from "vitest";
import {
  fetchTregBacklinksSummary,
  parseSerpstatBacklinksSummary,
} from "./client";

describe("treg backlinks pilot", () => {
  it("normalizes supported metrics and preserves provenance", () => {
    expect(
      parseSerpstatBacklinksSummary(
        {
          result: {
            data: { externalLinks: 120, referringDomains: 18, sdr: 37 },
          },
        },
        "example.com",
        new Date("2026-10-21T00:00:00.000Z"),
      ),
    ).toMatchObject({
      provider: "serpstat-via-treg",
      target: "example.com",
      backlinks: 120,
      referringDomains: 18,
      authority: 37,
      fetchedAt: "2026-10-21T00:00:00.000Z",
    });
  });

  it("does not invent numbers when provider fields are missing", () => {
    const data = parseSerpstatBacklinksSummary(
      { result: { data: { irrelevant: 20 } } },
      "example.com",
    );
    expect(data.backlinks).toBeNull();
    expect(data.referringDomains).toBeNull();
  });

  it("sends token only in a server-side header and never retries", async () => {
    const request = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ result: { data: { externalLinks: 5 } } }),
          { status: 200 },
        ),
    );
    await fetchTregBacklinksSummary("example.com", {
      token: "private-test-token",
      fetchImpl: request as typeof fetch,
    });
    expect(request).toHaveBeenCalledTimes(1);
    const [url, options] = request.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://treg.to/call/serpstat.web.backlinks.summary");
    expect((options.headers as Record<string, string>)["X-Treg-Token"]).toBe(
      "private-test-token",
    );
    expect(options.body).not.toContain("private-test-token");
  });

  it("rejects path, URL, and invalid scope before calling provider", async () => {
    const request = vi.fn();
    await expect(
      fetchTregBacklinksSummary("https://example.com/", {
        token: "test",
        fetchImpl: request as typeof fetch,
      }),
    ).rejects.toThrow("bare domain");
    expect(request).not.toHaveBeenCalled();
  });

  it("does not retry on a provider failure", async () => {
    const request = vi.fn(async () => new Response("denied", { status: 429 }));
    await expect(
      fetchTregBacklinksSummary("example.com", {
        token: "test",
        fetchImpl: request as typeof fetch,
      }),
    ).rejects.toThrow("HTTP 429");
    expect(request).toHaveBeenCalledTimes(1);
  });
});
