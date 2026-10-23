import { describe, expect, it } from "vitest";
import { isUnpitchableDomain } from "./prospectFinders";

describe("isUnpitchableDomain", () => {
  it("rejects government sites and giant publishers, not ordinary sites", () => {
    for (const domain of [
      "energy.gov",
      "www.health.gov.au",
      "army.mil",
      "blog.google",
      "www.forbes.com",
      "en.wikipedia.org",
    ])
      expect(isUnpitchableDomain(domain), domain).toBe(true);
    for (const domain of [
      "utahcanna.org",
      "govhealthblog.com",
      "sbecouncil.org",
    ])
      expect(isUnpitchableDomain(domain), domain).toBe(false);
  });
});
