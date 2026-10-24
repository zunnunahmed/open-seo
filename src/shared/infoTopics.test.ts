import { describe, expect, it } from "vitest";
import { cleanTopics, isWordMatch } from "./infoTopics";

describe("isWordMatch", () => {
  it.each([
    ["carpal tunnel exercises", "best carpal tunnel exercise", true],
    ["exercises for carpal tunnel", "carpal tunnel exercises", true],
    ["wrist pain at night", "wrist pain", false],
    ["carpal tunnel", "carpal tunnel carpal tunnel", false],
    ["carpal tunnel", "carpal tunnels", true],
  ])("%s → %s: %s", (topic, keyword, expected) => {
    expect(isWordMatch(topic, keyword)).toBe(expected);
  });
});

describe("cleanTopics", () => {
  it("removes duplicates, merges re-spellings and keeps different searches", () => {
    const result = cleanTopics([
      "Super Calculator",
      "super  calculator",
      "a super calculators",
      "calculator super",
      "how to budget for retirement",
      "retirement budget",
      "x",
    ]);

    expect(result.topics).toEqual([
      "Super Calculator",
      "how to budget for retirement",
      "retirement budget",
    ]);
    expect(result.exactDuplicates).toBe(1);
    expect(result.merged.map((entry) => entry.removed)).toEqual([
      "a super calculators",
      "calculator super",
    ]);
    expect(result.invalid).toBe(1);
  });
});
