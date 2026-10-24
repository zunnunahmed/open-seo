import { describe, expect, it } from "vitest";
import { applyMetricFilter } from "@/server/features/gsc/searchPerformanceReport";
import { metricFilterFromSearch } from "./metricFilters";

const row = (clicks: number, impressions: number, position: number) => ({
  clicks,
  impressions,
  position,
});

describe("metric filters", () => {
  it("narrows a category's clicks with any typed range", () => {
    expect(metricFilterFromSearch({ category: "Weak", clicksMin: 50 })).toEqual(
      expect.objectContaining({ minClicks: 50, maxClicks: 99 }),
    );
    expect(metricFilterFromSearch({})).toBeUndefined();
  });

  it("keeps rows inside every range, bounds included", () => {
    const rows = [row(0, 10, 3), row(50, 500, 8.5), row(120, 900, 12)];
    expect(
      applyMetricFilter(rows, {
        minClicks: 1,
        maxClicks: 99,
        minImpressions: 500,
        maxPosition: 8.5,
      }),
    ).toEqual([row(50, 500, 8.5)]);
  });
});
