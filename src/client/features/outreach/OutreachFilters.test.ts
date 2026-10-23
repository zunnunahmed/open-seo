import { describe, expect, it } from "vitest";
import { domainCountry, domainTld, GLOBAL } from "./OutreachFilters";

describe("prospect domain filters", () => {
  it.each([
    ["sparkinteract.com.au", ".com.au", "au"],
    ["news.bbc.co.uk", ".co.uk", "uk"],
    ["example.au", ".au", "au"],
    ["blog.example.com", ".com", GLOBAL],
    ["example.io", ".io", GLOBAL],
  ])("reads %s as ending %s in country %s", (domain, tld, country) => {
    expect(domainTld(domain)).toBe(tld);
    expect(domainCountry(domain)).toBe(country);
  });
});
