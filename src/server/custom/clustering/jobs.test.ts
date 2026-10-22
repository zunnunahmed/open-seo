import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as DataforseoModule from "./dataforseo";

const fetchResult = vi.fn<typeof DataforseoModule.fetchClusterSerpTaskResult>();
vi.mock("./dataforseo", async (importOriginal) => ({
  ...(await importOriginal<typeof DataforseoModule>()),
  fetchClusterSerpTaskResult: (taskId: string) => fetchResult(taskId),
}));

const { advanceJob } = await import("./jobs");
const { createJob, estimateJobUsd, getChunk, getJob, listJobs } =
  await import("./jobStore");

function fakeBucket() {
  const store = new Map<string, { value: string; etag: string }>();
  let version = 0;
  return {
    store,
    get: async (key: string) => {
      const entry = store.get(key);
      return entry ? { text: async () => entry.value, etag: entry.etag } : null;
    },
    put: async (
      key: string,
      value: string,
      options?: { onlyIf?: { etagMatches: string } },
    ) => {
      const current = store.get(key);
      if (options?.onlyIf && current?.etag !== options.onlyIf.etagMatches)
        return null;
      store.set(key, { value, etag: `v${++version}` });
      return {};
    },
    delete: async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) store.delete(key);
    },
  };
}

function fakeClient() {
  let task = 0;
  return {
    labs: { keywordOverview: vi.fn(async () => []) },
    keywords: { adsSearchVolume: vi.fn(async () => []) },
    serp: {
      clusterTaskPost: vi.fn(
        async (input: { tasks: Array<{ keyword: string; tag: string }> }) =>
          input.tasks.map((t) => ({ tag: t.tag, taskId: `task-${++task}` })),
      ),
      live: vi.fn(async (_input: { keyword: string }) => [
        { type: "organic", rank_group: 1, url: "https://a.com/x" },
      ]),
    },
  };
}

const keywords = Array.from({ length: 150 }, (_, i) => ({
  keyword: `keyword ${i}`,
  volume: 10,
  cpc: null,
}));

async function newJob(
  bucket: ReturnType<typeof fakeBucket>,
  route: "direct_dataforseo" | "treg_dataforseo" = "direct_dataforseo",
) {
  return createJob(bucket, "p1", {
    name: "Test",
    keywords,
    fetchVolume: false,
    locationCode: 2036,
    languageCode: "en",
    route,
  });
}

describe("keyword clustering jobs", () => {
  beforeEach(() => {
    fetchResult.mockReset();
  });

  it("estimates queued SERP cost per keyword", () => {
    const estimate = estimateJobUsd(keywords, false, 2036, "en");
    expect(estimate.serps).toBeCloseTo(150 * 0.0006, 6);
    expect(estimate.volume).toBe(0);
  });

  it("does not spend anything until the draft is confirmed", async () => {
    const bucket = fakeBucket();
    const client = fakeClient();
    const job = await newJob(bucket);
    expect(job).toMatchObject({ status: "draft", chunkCount: 2, total: 150 });
    const step = await advanceJob(bucket, "p1", job.id, client);
    expect(step.phase).toBe("busy");
    expect(client.serp.clusterTaskPost).not.toHaveBeenCalled();
  });

  it("posts each chunk once, collects results and finishes", async () => {
    const bucket = fakeBucket();
    const client = fakeClient();
    const job = await newJob(bucket);

    const posted = await advanceJob(bucket, "p1", job.id, client, {
      start: true,
    });
    expect(posted.phase).toBe("posting");
    expect(client.serp.clusterTaskPost).toHaveBeenCalledTimes(2);
    expect((await getChunk(bucket, "p1", job.id, 0))?.tasks["keyword 0"]).toBe(
      "task-1",
    );

    fetchResult.mockResolvedValue({ status: "pending" });
    const waiting = await advanceJob(bucket, "p1", job.id, client);
    expect(waiting).toMatchObject({ phase: "collecting", collected: 0 });

    fetchResult.mockResolvedValue({
      status: "completed",
      serp: { urls: ["a.com/x"], features: [] },
    });
    let step = waiting;
    for (let i = 0; i < 20 && step.phase !== "done"; i++)
      step = await advanceJob(bucket, "p1", job.id, client);
    expect(step.phase).toBe("done");
    expect(step.job.completed).toBe(150);
    // Posting never repeats after the chunks are recorded.
    expect(client.serp.clusterTaskPost).toHaveBeenCalledTimes(2);
    expect((await listJobs(bucket, "p1"))[0].status).toBe("done");
  });

  it("fetches each SERP live once on a treg route, without the queue", async () => {
    const bucket = fakeBucket();
    const client = fakeClient();
    const job = await newJob(bucket, "treg_dataforseo");

    let step = await advanceJob(bucket, "p1", job.id, client, { start: true });
    for (let i = 0; i < 20 && step.phase !== "done"; i++)
      step = await advanceJob(bucket, "p1", job.id, client);

    expect(step.phase).toBe("done");
    expect(step.job.completed).toBe(150);
    expect(client.serp.live).toHaveBeenCalledTimes(150);
    expect(client.serp.clusterTaskPost).not.toHaveBeenCalled();
    expect(
      (await getChunk(bucket, "p1", job.id, 1))?.serps["keyword 149"],
    ).toEqual({ urls: ["a.com/x"], features: [] });
  });

  it("tells a second tab to wait while a step holds the lease", async () => {
    const bucket = fakeBucket();
    const job = await newJob(bucket);
    const key = [...bucket.store.keys()].find((k) => k.endsWith("meta.json"));
    const meta = await getJob(bucket, "p1", job.id);
    if (!key || !meta) throw new Error("missing meta");
    await bucket.put(
      key,
      JSON.stringify({ ...meta, lockUntil: Date.now() + 30_000 }),
    );
    const step = await advanceJob(bucket, "p1", job.id, fakeClient(), {
      start: true,
    });
    expect(step.phase).toBe("busy");
  });

  it("surfaces errors when every collection request fails", async () => {
    const bucket = fakeBucket();
    const client = fakeClient();
    const job = await newJob(bucket);
    await advanceJob(bucket, "p1", job.id, client, { start: true });
    fetchResult.mockRejectedValue(new Error("auth failed"));
    await expect(advanceJob(bucket, "p1", job.id, client)).rejects.toThrow(
      "auth failed",
    );
    // The lease is released, so a retry can run.
    expect((await getJob(bucket, "p1", job.id))?.lockUntil).toBe(0);
  });
});
