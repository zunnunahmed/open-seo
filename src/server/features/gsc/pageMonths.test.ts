import { describe, expect, it } from "vitest";
import { lastTwelveMonths } from "./pageMonths";

describe("lastTwelveMonths", () => {
  it("covers 12 calendar months, oldest first, this month up to today", () => {
    const months = lastTwelveMonths(new Date("2026-03-15T10:00:00Z"));

    expect(months).toHaveLength(12);
    expect(months[0]).toEqual({
      month: "2025-04",
      startDate: "2025-04-01",
      endDate: "2025-04-30",
      partial: false,
    });
    expect(months[10]).toMatchObject({
      month: "2026-02",
      endDate: "2026-02-28",
    });
    expect(months[11]).toEqual({
      month: "2026-03",
      startDate: "2026-03-01",
      endDate: "2026-03-15",
      partial: true,
    });
  });
});
