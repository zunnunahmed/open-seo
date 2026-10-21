import { describe, expect, it, vi } from "vitest";

vi.mock(
  "@/server/features/project-context/repositories/ProjectContextRepository",
  () => ({
    ProjectContextRepository: { listSections: vi.fn(async () => []) },
  }),
);
import {
  isProviderAllowed,
  parseSeoProviderPreference,
} from "./projectPreference";

describe("per-project SEO provider preference", () => {
  it.each(["", "unexpected", "dataforseo", null, undefined])(
    "defaults to DataForSEO for %s",
    (value) => {
      expect(parseSeoProviderPreference(value)).toBe("dataforseo");
    },
  );
  it("allows only the selected provider", () => {
    expect(isProviderAllowed("treg", "dataforseo")).toBe(false);
    expect(isProviderAllowed("treg", "treg")).toBe(true);
    expect(isProviderAllowed("dataforseo", "treg")).toBe(false);
    expect(isProviderAllowed("both", "treg")).toBe(true);
    expect(isProviderAllowed("both", "dataforseo")).toBe(true);
  });
});
