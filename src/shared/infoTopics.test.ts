import { describe, expect, it } from "vitest";
import { isWordMatch } from "./infoTopics";

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
