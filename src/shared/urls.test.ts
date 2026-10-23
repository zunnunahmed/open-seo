import { describe, expect, it } from "vitest";
import { toBareDomain } from "./urls";

describe("toBareDomain", () => {
  it.each([
    ["example.com", "example.com"],
    ["https://example.com/", "example.com"],
    ["https://www.sparkinteract.com.au/", "www.sparkinteract.com.au"],
    ["http://example.com/some/page?q=1", "example.com"],
    ["  EXAMPLE.com  ", "example.com"],
    ["example.com:8080/path", "example.com"],
    ["example.com.", "example.com"],
    ["sub.domain.example.co.uk/a?b=c#d", "sub.domain.example.co.uk"],
  ])("normalizes %p to %p", (input, expected) => {
    expect(toBareDomain(input)).toBe(expected);
  });

  it.each([[""], ["   "], ["not a domain"], ["https://"], ["ftp://example.com/x"], ["http://"], ["a"], ["example"], ["http://exa mple.com"]])(
    "rejects %p",
    (input) => {
      expect(toBareDomain(input)).toBeNull();
    },
  );
});
