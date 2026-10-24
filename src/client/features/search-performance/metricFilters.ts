import type {
  MetricFilter,
  SearchPerformanceSearch,
} from "@/types/schemas/search-performance";
import type { MetricDraft } from "./MetricFilterFields";

type UrlCategory = NonNullable<SearchPerformanceSearch["category"]>;

/** Click range of each URL category (matches classifyGscUrl). */
const CATEGORY_CLICKS: Record<UrlCategory, [number, number | undefined]> = {
  Performance: [1001, undefined],
  Good: [500, 1000],
  Fair: [100, 499],
  Weak: [1, 99],
  Dead: [0, 0],
};

export const URL_CATEGORIES: UrlCategory[] = [
  "Performance",
  "Good",
  "Fair",
  "Weak",
  "Dead",
];

const maxOf = (a: number | undefined, b: number | undefined) =>
  a === undefined ? b : b === undefined ? a : Math.max(a, b);
const minOf = (a: number | undefined, b: number | undefined) =>
  a === undefined ? b : b === undefined ? a : Math.min(a, b);

/** The metric filter in the page URL; a category narrows the clicks range. */
export function metricFilterFromSearch(
  search: SearchPerformanceSearch,
): MetricFilter {
  const [categoryMin, categoryMax] = search.category
    ? CATEGORY_CLICKS[search.category]
    : [undefined, undefined];
  const filter = {
    minClicks: maxOf(search.clicksMin, categoryMin),
    maxClicks: minOf(search.clicksMax, categoryMax),
    minImpressions: search.imprMin,
    maxImpressions: search.imprMax,
    minPosition: search.posMin,
    maxPosition: search.posMax,
  };
  return Object.values(filter).some((value) => value !== undefined)
    ? filter
    : undefined;
}

/** How many metric filters are set, for the "N active" badge. */
export function metricFilterCount(search: SearchPerformanceSearch): number {
  return [
    search.category,
    search.clicksMin ?? search.clicksMax,
    search.imprMin ?? search.imprMax,
    search.posMin ?? search.posMax,
  ].filter((value) => value !== undefined).length;
}

/** URL settings that clear every metric filter. */
export const NO_METRIC_FILTERS = {
  category: undefined,
  clicksMin: undefined,
  clicksMax: undefined,
  imprMin: undefined,
  imprMax: undefined,
  posMin: undefined,
  posMax: undefined,
} satisfies Partial<SearchPerformanceSearch>;

/** A typed bound: a non-negative number, or no bound. */
function toBound(value: string): number | undefined {
  const number = Number(value);
  return value.trim() && Number.isFinite(number) && number >= 0
    ? number
    : undefined;
}

/** The panel's typed metric filters as URL settings. */
export function metricSearchFromDraft(
  draft: MetricDraft,
): Partial<SearchPerformanceSearch> {
  return {
    category: URL_CATEGORIES.find((category) => category === draft.category),
    clicksMin: toBound(draft.clicksMin),
    clicksMax: toBound(draft.clicksMax),
    imprMin: toBound(draft.imprMin),
    imprMax: toBound(draft.imprMax),
    posMin: toBound(draft.posMin),
    posMax: toBound(draft.posMax),
  };
}
