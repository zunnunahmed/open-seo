import { describe, expect, it } from "vitest";
import { classifyGscUrl } from "./urlCategories";

describe("GSC URL categorization", () => {
  it.each([
    [0, "Dead"],
    [1, "Weak"],
    [99, "Weak"],
    [100, "Fair"],
    [499, "Fair"],
    [500, "Good"],
    [999, "Good"],
    [1000, "Good"],
    [1001, "Performance"],
  ] as const)("classifies %i clicks as %s", (clicks, category) => {
    expect(classifyGscUrl(clicks).category).toBe(category);
  });
  it("rejects invalid metrics", () => {
    expect(() => classifyGscUrl(-1)).toThrow();
    expect(() => classifyGscUrl(Number.NaN)).toThrow();
  });
});
