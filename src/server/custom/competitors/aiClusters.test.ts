import { describe, expect, it } from "vitest";
import { readModelClusters } from "./aiClusters";

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
});
