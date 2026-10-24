import { useState } from "react";
import { CountryCombobox } from "@/client/components/CountryCombobox";
import { Checkbox } from "@/client/components/ui/checkbox";
import { Input } from "@/client/components/ui/input";
import { getIsoCountryCode, getLanguageCode } from "@/shared/keyword-locations";
import {
  DEFAULT_FOOTPRINTS,
  GUEST_POST_FOOTPRINTS,
  MAX_PROSPECT_SEARCHES,
  type FootprintId,
} from "@/shared/outreachFootprints";

const DEPTHS = [10, 20, 50, 100] as const;
type Depth = (typeof DEPTHS)[number];

const ENDING = /^[a-z0-9-]+(\.[a-z0-9-]+)*$/;

/** Country, domain endings, authority cap and guest-post phrases. */
export function useSearchOptions(projectLocationCode: number | null) {
  const [pickedCountry, setPickedCountry] = useState<number | null>(null);
  const country = pickedCountry ?? projectLocationCode;
  const iso = country ? getIsoCountryCode(country) : "us";
  // The country's own ending by default (none for the US); editable.
  const [pickedEndings, setPickedEndings] = useState<string | null>(null);
  const endingsText =
    pickedEndings ?? (iso === "us" ? "" : `.${iso === "gb" ? "uk" : iso}`);
  const [maxAuthority, setMaxAuthority] = useState("60");
  const [footprints, setFootprints] =
    useState<FootprintId[]>(DEFAULT_FOOTPRINTS);
  const [customFootprint, setCustomFootprint] = useState("");
  const [depth, setDepth] = useState<Depth>(100);

  return {
    country,
    endingsText,
    maxAuthority,
    footprints,
    customFootprint,
    depth,
    setCountry: (next: number) => {
      setPickedCountry(next);
      // Endings follow the new country unless typed again.
      setPickedEndings(null);
    },
    setEndingsText: setPickedEndings,
    setMaxAuthority,
    setFootprints,
    setCustomFootprint,
    setDepth,
    /** The fields every country-aware finder sends. */
    request: () => ({
      ...(country
        ? { locationCode: country, languageCode: getLanguageCode(country) }
        : {}),
      endings: [
        ...new Set(
          endingsText
            .toLowerCase()
            .split(/[\s,]+/)
            .map((ending) => ending.replace(/^\.+/, ""))
            .filter((ending) => ENDING.test(ending)),
        ),
      ].slice(0, 5),
      maxAuthority: Math.min(100, Math.max(1, Number(maxAuthority) || 60)),
    }),
  };
}

type Options = ReturnType<typeof useSearchOptions>;

export function SearchOptions({
  options,
  kind,
  queries,
}: {
  options: Options;
  kind: "guest_post" | "pr" | "search";
  /** The Google searches this run will make (guest posts). */
  queries: string[];
}) {
  if (!options.country) return null;
  const toggle = (id: FootprintId, on: boolean) =>
    options.setFootprints(
      on
        ? [...options.footprints, id]
        : options.footprints.filter((footprint) => footprint !== id),
    );
  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-medium">Country</span>
        <div className="w-60">
          <CountryCombobox
            value={options.country}
            onChange={options.setCountry}
          />
        </div>
        {kind !== "pr" ? (
          <>
            <label
              className="flex items-center gap-2"
              title="Only sites on these domain endings, separated by commas. Leave empty for any site."
            >
              Domain endings
              <Input
                className="h-8 w-40"
                value={options.endingsText}
                placeholder="Any, e.g. .au, .org"
                onChange={(event) => options.setEndingsText(event.target.value)}
              />
            </label>
            <label className="flex items-center gap-2">
              Max authority
              <Input
                className="h-8 w-20"
                type="number"
                min={1}
                max={100}
                value={options.maxAuthority}
                onChange={(event) =>
                  options.setMaxAuthority(event.target.value)
                }
              />
            </label>
          </>
        ) : null}
        {kind === "search" ? (
          <label className="flex items-center gap-2">
            Results per search
            <select
              className="h-8 rounded-md border bg-background px-2"
              value={options.depth}
              onChange={(event) => {
                const next = DEPTHS.find(
                  (depth) => depth === Number(event.target.value),
                );
                if (next) options.setDepth(next);
              }}
            >
              {DEPTHS.map((depth) => (
                <option key={depth} value={depth}>
                  {depth}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      {kind === "guest_post" ? (
        <div className="space-y-2">
          <p className="font-medium">Search phrases</p>
          <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-4">
            {GUEST_POST_FOOTPRINTS.map((footprint) => (
              <label
                key={footprint.id}
                className="flex items-center gap-2"
                title={footprint.query}
              >
                <Checkbox
                  checked={options.footprints.includes(footprint.id)}
                  onCheckedChange={(checked) => toggle(footprint.id, checked)}
                />
                {footprint.label}
              </label>
            ))}
          </div>
          <Input
            className="h-8"
            value={options.customFootprint}
            maxLength={150}
            placeholder='Your own phrase, e.g. intitle:"guest blogger" OR "write for us"'
            onChange={(event) => options.setCustomFootprint(event.target.value)}
          />
          {queries.length ? (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">
                {queries.length} Google{" "}
                {queries.length === 1 ? "search" : "searches"} (max{" "}
                {MAX_PROSPECT_SEARCHES}): show them
              </summary>
              <ul className="mt-1 space-y-0.5 font-mono">
                {queries.map((query) => (
                  <li key={query}>{query}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
