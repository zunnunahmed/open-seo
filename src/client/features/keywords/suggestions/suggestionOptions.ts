import type { SuggestionModifierGroup } from "@/server/features/keywords/services/searchSuggestions";

export type SuggestionRow = {
  keyword: string;
  placement: "before" | "after";
  modifier: string;
  seed: string;
  query: string;
};

export type DfsSuggestionRow = {
  keyword: string;
  searchVolume: number | null;
  cpc: number | null;
  competition: number | null;
  keywordDifficulty: number | null;
  intent:
    | "informational"
    | "commercial"
    | "transactional"
    | "navigational"
    | "unknown";
  seed: string;
};

export type SuggestEndpoint = "suggestqueries" | "www" | "toolbar";

export const ENDPOINT_LABELS: Record<SuggestEndpoint, string> = {
  suggestqueries: "suggest host",
  www: "www host",
  toolbar: "toolbar host",
};

export const COUNTRY_OPTIONS: Array<{ code: string; name: string }> = [
  { code: "AU", name: "Australia" },
  { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" },
  { code: "CA", name: "Canada" },
  { code: "NZ", name: "New Zealand" },
  { code: "IE", name: "Ireland" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
  { code: "NL", name: "Netherlands" },
  { code: "ES", name: "Spain" },
  { code: "IT", name: "Italy" },
  { code: "PT", name: "Portugal" },
  { code: "CH", name: "Switzerland" },
  { code: "AT", name: "Austria" },
  { code: "BE", name: "Belgium" },
  { code: "SE", name: "Sweden" },
  { code: "NO", name: "Norway" },
  { code: "DK", name: "Denmark" },
  { code: "FI", name: "Finland" },
  { code: "PL", name: "Poland" },
  { code: "GR", name: "Greece" },
  { code: "IN", name: "India" },
  { code: "PK", name: "Pakistan" },
  { code: "BD", name: "Bangladesh" },
  { code: "SG", name: "Singapore" },
  { code: "MY", name: "Malaysia" },
  { code: "PH", name: "Philippines" },
  { code: "ID", name: "Indonesia" },
  { code: "TH", name: "Thailand" },
  { code: "VN", name: "Vietnam" },
  { code: "JP", name: "Japan" },
  { code: "KR", name: "South Korea" },
  { code: "HK", name: "Hong Kong" },
  { code: "TW", name: "Taiwan" },
  { code: "AE", name: "United Arab Emirates" },
  { code: "SA", name: "Saudi Arabia" },
  { code: "IL", name: "Israel" },
  { code: "TR", name: "Türkiye" },
  { code: "ZA", name: "South Africa" },
  { code: "NG", name: "Nigeria" },
  { code: "KE", name: "Kenya" },
  { code: "EG", name: "Egypt" },
  { code: "BR", name: "Brazil" },
  { code: "MX", name: "Mexico" },
];

export const GROUP_OPTIONS: Array<{
  value: SuggestionModifierGroup;
  label: string;
  hint: string;
}> = [
  { value: "letters", label: "Letters a–z", hint: "52 queries per seed" },
  {
    value: "questions",
    label: "Questions",
    hint: "who, what, where… (24 per seed)",
  },
  {
    value: "commercial",
    label: "Commercial",
    hint: "best, price, near me… (22 per seed)",
  },
];

export const LIMIT_OPTIONS = [100, 200, 500] as const;
export type SuggestionLimit = (typeof LIMIT_OPTIONS)[number];

export const FREE_HEADERS = ["Keyword", "Position", "Modifier", "Seed query"];
export const DFS_HEADERS = [
  "Keyword",
  "Volume",
  "CPC",
  "Competition",
  "KD",
  "Intent",
  "Seed",
];
