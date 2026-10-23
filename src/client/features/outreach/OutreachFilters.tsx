import { sort } from "remeda";
import { Checkbox } from "@/client/components/ui/checkbox";
import { Input } from "@/client/components/ui/input";

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

export const EMPTY_FILTERS: OutreachFilterState = {
  country: "",
  tld: "",
  source: "",
  status: "",
  minAuthority: "",
  validEmailOnly: false,
};

const SELECT =
  "h-8 rounded-md border bg-background px-2 text-sm text-foreground";

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
      <select
        className={SELECT}
        aria-label="Country"
        value={value.country}
        onChange={(event) => set({ country: event.target.value })}
      >
        <option value="">All countries</option>
        {Object.entries(COUNTRIES).map(([code, name]) => (
          <option key={code} value={code}>
            {name} (.{code})
          </option>
        ))}
        <option value={GLOBAL}>Global (.com, .org, …)</option>
      </select>
      <select
        className={SELECT}
        aria-label="Domain ending"
        value={value.tld}
        onChange={(event) => set({ tld: event.target.value })}
      >
        <option value="">All endings</option>
        {tlds.map((tld) => (
          <option key={tld} value={tld}>
            {tld}
          </option>
        ))}
      </select>
      <select
        className={SELECT}
        aria-label="Source"
        value={value.source}
        onChange={(event) => set({ source: event.target.value })}
      >
        <option value="">All sources</option>
        <option value="backlinks">Backlinks</option>
        <option value="link_gap">Link gap</option>
        <option value="guest_post">Guest post</option>
        <option value="pr">PR</option>
        <option value="import">Import</option>
      </select>
      <select
        className={SELECT}
        aria-label="Status"
        value={value.status}
        onChange={(event) => set({ status: event.target.value })}
      >
        <option value="">All statuses</option>
        <option value="new">New</option>
        <option value="contacts_found">Contacts found</option>
        <option value="no_contacts">No contacts</option>
        <option value="sent">Sent</option>
        <option value="replied">Replied</option>
        <option value="won">Won</option>
        <option value="skipped">Skipped</option>
      </select>
      <Input
        className="h-8 w-36"
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
      (!filters.status || prospect.status === filters.status) &&
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
