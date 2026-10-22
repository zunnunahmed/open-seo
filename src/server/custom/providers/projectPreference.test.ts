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
    expect(parseSeoProviderPreference(value)).toBe("direct_dataforseo");
    },
  );
  it("allows only the selected provider", () => {
    expect(isProviderAllowed("treg_serpstat", "dataforseo")).toBe(false);
    expect(isProviderAllowed("treg_serpstat", "treg")).toBe(true);
    expect(isProviderAllowed("direct_dataforseo", "treg")).toBe(false);
    expect(isProviderAllowed("treg_dataforseo", "treg")).toBe(true);
    expect(isProviderAllowed("both", "treg")).toBe(true);
    expect(isProviderAllowed("both", "dataforseo")).toBe(true);
  });
});
