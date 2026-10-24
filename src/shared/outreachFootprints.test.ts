import { describe, expect, it } from "vitest";
import { guestPostQueries, MAX_PROSPECT_SEARCHES } from "./outreachFootprints";

describe("guestPostQueries", () => {
  it("pairs each topic with the chosen phrases and the user's own, capped", () => {
    expect(
      guestPostQueries(["seo"], ["write_for_us"], 'intitle:"guest blogger"'),
    ).toEqual(['seo intitle:"write for us"', 'seo intitle:"guest blogger"']);
    expect(
      guestPostQueries(
        ["a", "b", "c", "d", "e"],
        ["write_for_us", "guidelines", "contributor", "accepting", "sponsored"],
        "",
      ),
    ).toHaveLength(MAX_PROSPECT_SEARCHES);
  });
});
