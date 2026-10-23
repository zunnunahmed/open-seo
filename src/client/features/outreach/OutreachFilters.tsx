import { sort } from "remeda";
import { Checkbox } from "@/client/components/ui/checkbox";
import { Input } from "@/client/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";

/** Country codes a domain can end with, e.g. site.com.au -> au. */
const COUNTRIES: Record<string, string> = {
  au: "Australia",
  nz: "New Zealand",
  uk: "United Kingdom",
  us: "United States",
  ca: "Canada",
  ie: "Ireland",
  in: "India",
  sg: "Singapore",
  my: "Malaysia",
  ph: "Philippines",
  za: "South Africa",
  de: "Germany",
  fr: "France",
  es: "Spain",
  it: "Italy",
  nl: "Netherlands",
  ae: "United Arab Emirates",
  bd: "Bangladesh",
  pk: "Pakistan",
};
export const GLOBAL = "global";

/** Country of a domain from its country-code ending; generic TLDs are global. */
export function domainCountry(domain: string): string {
  const last = domain.toLowerCase().split(".").at(-1) ?? "";
  return last in COUNTRIES ? last : GLOBAL;
}

/** The domain's ending, e.g. ".com.au" or ".org". */
export function domainTld(domain: string): string {
  const parts = domain.toLowerCase().split(".");
  const last = parts.at(-1) ?? "";
  const second = parts.at(-2) ?? "";
  // site.com.au / site.co.uk: keep the second-level label with the country.
  return last.length === 2 &&
    parts.length > 2 &&
    ["com", "co", "org", "net", "gov", "edu", "ac"].includes(second)
    ? `.${second}.${last}`
    : `.${last}`;
}

type OutreachFilterState = {
  country: string;
  tld: string;
  source: string;
  status: string;
  minAuthority: string;
  validEmailOnly: boolean;
};

/** Shows every status except skipped. */
const ACTIVE = "active";

export const EMPTY_FILTERS: OutreachFilterState = {
  country: "",
  tld: "",
  source: "",
  status: ACTIVE,
  minAuthority: "",
  validEmailOnly: false,
};

const ALL = "all";

/** One filter dropdown; "" in the state means no filter. */
function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  const items = [{ value: ALL, label }, ...options];
  return (
    <Select
      items={items}
      value={value || ALL}
      onValueChange={(next) => onChange(!next || next === ALL ? "" : next)}
    >
      <SelectTrigger size="sm" className="w-auto min-w-36" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const SOURCES = [
  { value: "backlinks", label: "Backlinks" },
  { value: "link_gap", label: "Link gap" },
  { value: "guest_post", label: "Guest post" },
  { value: "pr", label: "PR" },
  { value: "import", label: "Import" },
];

const STATUSES = [
  { value: ACTIVE, label: "Hide skipped" },
  { value: "new", label: "New" },
  { value: "contacts_found", label: "Emails found" },
  { value: "no_contacts", label: "No emails" },
  { value: "sent", label: "Sent" },
  { value: "replied", label: "Replied" },
  { value: "won", label: "Link won" },
  { value: "skipped", label: "Skipped" },
];

/** Narrow the prospect list by country, domain ending, source and more. */
export function OutreachFilters({
  value,
  onChange,
  tlds,
}: {
  value: OutreachFilterState;
  onChange: (next: OutreachFilterState) => void;
  /** Domain endings present in the list, most common first. */
  tlds: string[];
}) {
  const set = (patch: Partial<OutreachFilterState>) =>
    onChange({ ...value, ...patch });
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5 text-sm">
      <FilterSelect
        label="All countries"
        value={value.country}
        onChange={(country) => set({ country })}
        options={[
          ...Object.entries(COUNTRIES).map(([code, name]) => ({
            value: code,
            label: `${name} (.${code})`,
          })),
          { value: GLOBAL, label: "Global (.com, .org, …)" },
        ]}
      />
      <FilterSelect
        label="All endings"
        value={value.tld}
        onChange={(tld) => set({ tld })}
        options={tlds.map((tld) => ({ value: tld, label: tld }))}
      />
      <FilterSelect
        label="All sources"
        value={value.source}
        onChange={(source) => set({ source })}
        options={SOURCES}
      />
      <FilterSelect
        label="All statuses"
        value={value.status}
        onChange={(status) => set({ status })}
        options={STATUSES}
      />
      <Input
        className="h-8 w-32"
        type="number"
        min={0}
        placeholder="Min authority"
        aria-label="Minimum authority"
        value={value.minAuthority}
        onChange={(event) => set({ minAuthority: event.target.value })}
      />
      <label className="flex items-center gap-2">
        <Checkbox
          checked={value.validEmailOnly}
          onCheckedChange={(checked) => set({ validEmailOnly: checked })}
        />
        Has a verified email
      </label>
    </div>
  );
}

type Filterable = {
  domain: string;
  source: string;
  status: string;
  authority: number | null;
  contacts: Array<{ verification: string }>;
};

export function applyOutreachFilters<T extends Filterable>(
  prospects: T[],
  filters: OutreachFilterState,
): T[] {
  const minAuthority = Number(filters.minAuthority);
  return prospects.filter(
    (prospect) =>
      (!filters.country ||
        domainCountry(prospect.domain) === filters.country) &&
      (!filters.tld || domainTld(prospect.domain) === filters.tld) &&
      (!filters.source || prospect.source === filters.source) &&
      (filters.status === ACTIVE
        ? prospect.status !== "skipped"
        : !filters.status || prospect.status === filters.status) &&
      (!filters.minAuthority || (prospect.authority ?? 0) >= minAuthority) &&
      (!filters.validEmailOnly ||
        prospect.contacts.some((c) => c.verification === "valid")),
  );
}

/** Domain endings in the list, most common first. */
export function tldOptions(prospects: Array<{ domain: string }>): string[] {
  const counts = new Map<string, number>();
  for (const prospect of prospects) {
    const tld = domainTld(prospect.domain);
    counts.set(tld, (counts.get(tld) ?? 0) + 1);
  }
  return sort([...counts.entries()], (a, b) => b[1] - a[1]).map(([tld]) => tld);
}
