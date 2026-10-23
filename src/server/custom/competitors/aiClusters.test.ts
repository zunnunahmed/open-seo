import { describe, expect, it } from "vitest";
import { parseModelJson, readModelClusters } from "./aiClusters";

const pages = [
  { url: "https://a.com/web-design/", path: "/web-design/" },
  { url: "https://a.com/seo/", path: "/seo/" },
  { url: "https://a.com/blog/", path: "/blog/" },
];

describe("readModelClusters", () => {
  it("reads the requested shape and reports pages the model skipped", () => {
    expect(
      readModelClusters(
        {
          clusters: [
            { name: "Services", intent: "commercial", indices: [0, 1, 1, 9] },
          ],
        },
        pages,
      ),
    ).toEqual({
      clusters: [
        {
          name: "Services",
          intent: "commercial",
          urls: ["https://a.com/web-design/", "https://a.com/seo/"],
        },
      ],
      skipped: ["https://a.com/blog/"],
    });
  });

  it("accepts a bare array with renamed keys and pages as strings or paths", () => {
    const { clusters, skipped } = readModelClusters(
      [
        { topic: "Design", pages: ["0", "/seo/"] },
        { title: "Blog", urls: ["https://a.com/blog/"] },
      ],
      pages,
    );

    expect(clusters.map((cluster) => cluster.urls.length)).toEqual([2, 1]);
    expect(clusters.map((cluster) => cluster.name)).toEqual(["Design", "Blog"]);
    expect(skipped).toEqual([]);
  });

  it("explains an answer without any topic groups", () => {
    expect(() => readModelClusters({ summary: "web agency" }, pages)).toThrow(
      "no list of topic groups",
    );
  });

  // Plain-text replies (the retry without JSON mode) often wrap the JSON.
  it("finds the JSON inside a chatty or fenced reply", () => {
    const json = '{"clusters":[{"name":"SEO","indices":[1]}]}';
    const chatty = `Sure! Here are the groups:\n${json}\nHope this helps.`;
    expect(parseModelJson(chatty)).toEqual(JSON.parse(json));
    expect(parseModelJson("```json\n" + json + "\n```")).toEqual(
      JSON.parse(json),
    );
  });

  it("rejects a junk number such as a broken JSON mode returns", () => {
    expect(() =>
      readModelClusters(parseModelJson("1.0000000000000002e+308"), pages),
    ).toThrow("no list of topic groups");
  });
});
