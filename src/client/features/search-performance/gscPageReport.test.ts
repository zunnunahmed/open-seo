import { describe, expect, it } from "vitest";
import { buildPageReport } from "./gscPageReport";

describe("buildPageReport", () => {
  it("puts health, performance, months, SERP and queries in one document", () => {
    const report = buildPageReport(
      "https://site.com/page/",
      {
        connected: true,
        range: { startDate: "2026-09-23", endDate: "2026-10-21" },
        inspection: {
          url: "https://site.com/page/",
          result: {
            indexStatusResult: { verdict: "PASS", coverageState: "Indexed" },
          },
        },
        queries: [
          { query: "low", clicks: 1, impressions: 10, ctr: 0.1, position: 9 },
          {
            query: "a | b",
            clicks: 5,
            impressions: 90,
            ctr: 0.05,
            position: 3,
          },
        ],
        queryCount: 2,
        queriesCapped: false,
        months: [
          {
            month: "2026-10",
            partial: true,
            queries: 2,
            capped: false,
            clicks: 6,
            impressions: 100,
          },
        ],
      },
      {
        keyword: "a b",
        items: [
          {
            rank: 1,
            title: "Rival",
            url: "https://rival.com/",
            domain: "rival.com",
            description: "",
            etv: null,
            estimatedPaidTrafficCost: null,
            referringDomains: null,
            backlinks: null,
            isNew: false,
            rankChange: null,
          },
        ],
      },
    );

    expect(report).toContain("Index verdict: PASS (Indexed)");
    expect(report).toContain("- Clicks: 6");
    expect(report).toContain("| 2026-10 (so far) | 2 | 6 | 100 |");
    expect(report).toContain('## Live Google results for "a b"');
    // Most impressions first, and a "|" in a query cannot break the table.
    expect(report.indexOf("| a / b |")).toBeLessThan(report.indexOf("| low |"));
  });
});
