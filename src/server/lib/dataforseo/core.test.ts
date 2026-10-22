import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/lib/runtime-env", () => ({
  getRequiredEnvValue: vi.fn(async () => "encoded-credentials"),
  getOptionalEnvValue: vi.fn(async (name: string) =>
    name === "CUSTOM_TREG_ENABLED" ? "true" : "treg-token",
  ),
}));

import { dataforseoGet, dataforseoPost } from "@/server/lib/dataforseo/core";
import { runWithSeoProviderRoute } from "@/server/custom/providers/treg/dataforseoTransport";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DataForSEO transport", () => {
  it("retries a transient 5xx on idempotent reads and returns the parsed envelope", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("upstream failure", { status: 503 }))
      .mockResolvedValueOnce(Response.json({ status_code: 20000, tasks: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      dataforseoPost("/v3/backlinks/summary/live", []),
    ).resolves.toEqual({ status_code: 20000, tasks: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.dataforseo.com/v3/backlinks/summary/live");
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      "Basic encoded-credentials",
    );
  });

  // The request-deadline abort arrives as a bare DOMException. Left unclassified
  // it escapes as an anonymous INTERNAL_ERROR; retrying it would replay a call
  // DataForSEO may already have billed. Both names are reachable: the shared
  // budget aborts with TimeoutError, Lighthouse's own controller with AbortError.
  it.each(["TimeoutError", "AbortError"])(
    "maps a %s abort to UPSTREAM_UNAVAILABLE without retrying",
    async (name) => {
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockRejectedValue(new DOMException("aborted", name));
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        dataforseoPost("/v3/serp/google/organic/live/advanced", []),
      ).rejects.toMatchObject({
        code: "UPSTREAM_UNAVAILABLE",
        name: "DataForSEOTimeoutError",
      });
      expect(fetchMock).toHaveBeenCalledOnce();
    },
  );

  it("sends the same request through treg on the treg → DataForSEO route", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ status_code: 20000, tasks: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const tasks = [{ keyword: "coffee" }];

    await expect(
      runWithSeoProviderRoute("treg_dataforseo", () =>
        dataforseoPost("/v3/serp/google/organic/live/advanced", tasks),
      ),
    ).resolves.toEqual({ status_code: 20000, tasks: [] });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://treg.to/call/dataforseo.x.serp-google-organic-live-advanced",
    );
    expect(new Headers(init?.headers).get("X-Treg-Token")).toBe("treg-token");
    expect(new Headers(init?.headers).has("Authorization")).toBe(false);
    expect(init?.body).toBe(JSON.stringify(tasks));
  });

  it.each([
    [
      "treg_dataforseo",
      () => dataforseoGet("/v3/serp/google/organic/task_get/advanced/1"),
    ],
    [
      "treg_dataforseo",
      () => dataforseoPost("/v3/serp/google/organic/task_post", []),
    ],
    [
      "treg_serpstat",
      () => dataforseoPost("/v3/backlinks/summary/live", [{ target: "a.com" }]),
    ],
  ] as const)(
    "refuses a request %s cannot serve instead of using another provider",
    async (route, request) => {
      const fetchMock = vi.fn<typeof fetch>();
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        runWithSeoProviderRoute(route, request),
      ).rejects.toMatchObject({ code: "PROVIDER_ROUTE_UNSUPPORTED" });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});
