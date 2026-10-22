import { describe, expect, it, vi } from "vitest";

vi.mock(
  "@/server/features/project-context/repositories/ProjectContextRepository",
  () => ({
    ProjectContextRepository: { listSections: vi.fn(async () => []) },
  }),
);
import { parseSeoProviderPreference } from "./projectPreference";

describe("per-project SEO provider preference", () => {
  it.each(["", "unexpected", "dataforseo", "both", null, undefined])(
    "keeps %s on direct DataForSEO",
    (value) => {
      expect(parseSeoProviderPreference(value)).toBe("direct_dataforseo");
    },
  );

  it("maps the legacy treg value to treg → Serpstat", () => {
    expect(parseSeoProviderPreference("treg")).toBe("treg_serpstat");
  });
});
