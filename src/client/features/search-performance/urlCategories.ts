/** Click-based GSC URL performance categories for the selected report date range.
 * Thresholds are mutually exclusive. Missing GSC rows are NOT dead URLs.
 */
const GSC_URL_CATEGORIES = [
  "Performance",
  "Good",
  "Fair",
  "Weak",
  "Dead",
] as const;
type GscUrlCategory = (typeof GSC_URL_CATEGORIES)[number];
type GscUrlAssessment = { category: GscUrlCategory; action: string };

export function classifyGscUrl(clicks: number): GscUrlAssessment {
  if (!Number.isFinite(clicks) || clicks < 0)
    throw new Error("Invalid GSC clicks");
  if (clicks > 1000)
    return { category: "Performance", action: "Protect & grow" };
  if (clicks >= 500) return { category: "Good", action: "Maintain & improve" };
  if (clicks >= 100)
    return { category: "Fair", action: "Content optimization" };
  if (clicks >= 1)
    return { category: "Weak", action: "Refresh or consolidate" };
  return { category: "Dead", action: "Investigate zero-click page" };
}
