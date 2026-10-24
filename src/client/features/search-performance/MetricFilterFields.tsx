import { Input } from "@/client/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import type { SearchPerformanceSearch } from "@/types/schemas/search-performance";
import { URL_CATEGORIES } from "./metricFilters";

/** The metric filter as typed in the panel (empty string = no bound). */
export type MetricDraft = {
  category: string;
  clicksMin: string;
  clicksMax: string;
  imprMin: string;
  imprMax: string;
  posMin: string;
  posMax: string;
};

const text = (value: number | undefined) =>
  value === undefined ? "" : String(value);

export function metricDraftFromSearch(
  search: SearchPerformanceSearch,
): MetricDraft {
  return {
    category: search.category ?? "",
    clicksMin: text(search.clicksMin),
    clicksMax: text(search.clicksMax),
    imprMin: text(search.imprMin),
    imprMax: text(search.imprMax),
    posMin: text(search.posMin),
    posMax: text(search.posMax),
  };
}

export const EMPTY_METRIC_DRAFT: MetricDraft = metricDraftFromSearch({});

const ALL = "all";
const CATEGORY_ITEMS = [
  { value: ALL, label: "All categories" },
  ...URL_CATEGORIES.map((category) => ({ value: category, label: category })),
];

const label =
  "text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";

function Range({
  title,
  min,
  max,
  step,
  onMin,
  onMax,
}: {
  title: string;
  min: string;
  max: string;
  step?: string;
  onMin: (value: string) => void;
  onMax: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <span className={label}>{title}</span>
      <div className="flex items-center gap-2">
        <Input
          className="h-7"
          type="number"
          min={0}
          step={step}
          placeholder="Min"
          aria-label={`${title} minimum`}
          value={min}
          onChange={(event) => onMin(event.target.value)}
        />
        <span className="text-muted-foreground">–</span>
        <Input
          className="h-7"
          type="number"
          min={0}
          step={step}
          placeholder="Max"
          aria-label={`${title} maximum`}
          value={max}
          onChange={(event) => onMax(event.target.value)}
        />
      </div>
    </div>
  );
}

/** Category, clicks, impressions and position filters for the tables. */
export function MetricFilterFields({
  draft,
  onChange,
}: {
  draft: MetricDraft;
  onChange: (next: MetricDraft) => void;
}) {
  const set = (patch: Partial<MetricDraft>) => onChange({ ...draft, ...patch });
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className="space-y-1.5">
        <span className={label}>Category (pages)</span>
        <Select
          items={CATEGORY_ITEMS}
          value={draft.category || ALL}
          onValueChange={(next) =>
            set({ category: !next || next === ALL ? "" : next })
          }
        >
          <SelectTrigger size="sm" className="w-full" aria-label="URL category">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CATEGORY_ITEMS.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Range
        title="Clicks"
        min={draft.clicksMin}
        max={draft.clicksMax}
        onMin={(clicksMin) => set({ clicksMin })}
        onMax={(clicksMax) => set({ clicksMax })}
      />
      <Range
        title="Impressions"
        min={draft.imprMin}
        max={draft.imprMax}
        onMin={(imprMin) => set({ imprMin })}
        onMax={(imprMax) => set({ imprMax })}
      />
      <Range
        title="Position"
        min={draft.posMin}
        max={draft.posMax}
        step="0.1"
        onMin={(posMin) => set({ posMin })}
        onMax={(posMax) => set({ posMax })}
      />
    </div>
  );
}
