import { sort } from "remeda";
import { isPlatformDomain } from "./serpPlatforms";

/**
 * SERP-based keyword clustering: keywords whose top-10 Google results share
 * enough URLs target the same intent and belong on one page. Pure functions,
 * shared by the server (SERP normalization, input cleanup) and the browser
 * (clustering runs client-side so changing the threshold or mode is instant
 * and free).
 */

export const MAX_CLUSTER_KEYWORDS = 5000;
export const MAX_KEYWORD_LENGTH = 80;

/** Normalized top-10 organic URLs plus SERP feature types for one keyword. */
export type ClusterSerp = { urls: string[]; features: string[] };

export type ClusterInputKeyword = {
  keyword: string;
  volume: number | null;
  cpc: number | null;
};

export type ClusterMode = "soft" | "strict" | "balanced";
export type ClusterPrimaryBy = "volume" | "cpc";

/**
 * Compare URLs, not strings: ignore scheme, `www.`, query, fragment and a
 * trailing slash, so the same page counts once across SERPs.
 */
export function normalizeSerpUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const path = url.pathname.replace(/\/+$/, "");
    return `${host}${path}`;
  } catch {
    return null;
  }
}

export function urlDomain(normalizedUrl: string): string {
  const slash = normalizedUrl.indexOf("/");
  return slash === -1 ? normalizedUrl : normalizedUrl.slice(0, slash);
}

function cleanKeyword(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Trim, lowercase, collapse whitespace and de-duplicate. The first volume/CPC
 * seen for a keyword wins. Over-long and empty entries are dropped.
 */
export function cleanKeywordList(rows: ClusterInputKeyword[]): {
  keywords: ClusterInputKeyword[];
  duplicates: number;
  invalid: number;
} {
  const seen = new Map<string, ClusterInputKeyword>();
  let duplicates = 0;
  let invalid = 0;
  for (const row of rows) {
    const keyword = cleanKeyword(row.keyword);
    if (!keyword || keyword.length > MAX_KEYWORD_LENGTH) {
      if (row.keyword.trim()) invalid++;
      continue;
    }
    if (seen.has(keyword)) {
      duplicates++;
      continue;
    }
    seen.set(keyword, { keyword, volume: row.volume, cpc: row.cpc });
  }
  return { keywords: [...seen.values()], duplicates, invalid };
}

function parseNumber(value: string | undefined): number | null {
  if (value == null) return null;
  const cleaned = value.replace(/[$,\s]/g, "");
  if (!cleaned) return null;
  const number = Number(cleaned);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

/**
 * Parse pasted text: one keyword per line, optionally followed by a tab or
 * comma and a search volume, then CPC (the shape of a spreadsheet copy).
 */
export function parseKeywordLines(text: string): ClusterInputKeyword[] {
  return (
    text
      .split(/\r?\n/)
      // Tab-separated rows (a spreadsheet copy) may hold "1,900" volumes, so
      // only fall back to commas when a line has no tab.
      .map((line) => line.split(line.includes("\t") ? "\t" : ","))
      .filter((parts) => parts[0]?.trim())
      .map(([keyword, volume, cpc]) => ({
        keyword,
        volume: parseNumber(volume),
        cpc: parseNumber(cpc),
      }))
  );
}

/** Map CSV rows using `keyword`/`query`, `volume` and `cpc` style headers. */
export function parseKeywordCsvRows(
  rows: Array<Record<string, string | undefined>>,
): ClusterInputKeyword[] {
  if (rows.length === 0) return [];
  const headers = Object.keys(rows[0]);
  const find = (patterns: RegExp[]) =>
    headers.find((header) =>
      patterns.some((pattern) => pattern.test(header.trim().toLowerCase())),
    );
  const keywordKey =
    find([/^keywords?$/, /^query$/, /^queries$/, /^search term/, /keyword/]) ??
    headers[0];
  const volumeKey = find([/volume/, /^searches/, /^sv$/]);
  const cpcKey = find([/^cpc/, /cost per click/]);
  return rows.map((row) => ({
    keyword: row[keywordKey] ?? "",
    volume: volumeKey ? parseNumber(row[volumeKey]) : null,
    cpc: cpcKey ? parseNumber(row[cpcKey]) : null,
  }));
}

export type ClusterableKeyword = ClusterInputKeyword & ClusterSerp;

export type PageType =
  | "Homepage"
  | "Article"
  | "Product"
  | "Category"
  | "Location"
  | "Service"
  | "Other";

/** Best-effort page type from a normalized URL's path. A heuristic, not truth. */
export function pageTypeForUrl(normalizedUrl: string): PageType {
  const path = normalizedUrl.slice(urlDomain(normalizedUrl).length);
  if (path === "" || path === "/") return "Homepage";
  if (
    /\/(blog|news|articles?|guides?|resources|learn|insights|magazine|wiki|how-to)(\/|$)/.test(
      path,
    ) ||
    /\/\d{4}\/\d{2}\//.test(path)
  )
    return "Article";
  if (/\/(products?|p|dp|item|items)\//.test(path)) return "Product";
  if (
    /\/(category|categories|collections?|c|shop|store|catalog|catalogue)(\/|$)/.test(
      path,
    )
  )
    return "Category";
  if (/\/(locations?|areas?|suburbs?|near-me|service-areas?)(\/|$)/.test(path))
    return "Location";
  if (/\/services?(\/|$)/.test(path)) return "Service";
  return "Other";
}

export type KeywordCluster = {
  id: number;
  main: ClusterableKeyword;
  keywords: ClusterableKeyword[];
  totalVolume: number;
  /** URLs ranking for at least half of the cluster's keywords. */
  sharedUrls: string[];
  topDomains: Array<{ domain: string; count: number }>;
  pageType: PageType;
  /** SERP features present for at least half of the cluster's keywords. */
  features: string[];
  /** Distinct URLs on the project domain found in the cluster's SERPs. */
  ownUrls: string[];
};

type ClusterOptions = {
  threshold: number;
  mode: ClusterMode;
  primaryBy: ClusterPrimaryBy;
  /** Project domain, to find your ranking pages and cannibalization. */
  ownDomain?: string | null;
  /** Leave directories, social and marketplace URLs out of the matching. */
  ignorePlatforms?: boolean;
  /** A shared #1-3 result counts more than a shared #7-10. */
  weightTop?: boolean;
};

/** Settings a user picks for a run; saved with it. */
export type ClusterSettings = {
  threshold: number;
  mode: ClusterMode;
  primaryBy: ClusterPrimaryBy;
  competitors: string;
  ignorePlatforms: boolean;
  weightTop: boolean;
};

export const DEFAULT_CLUSTER_SETTINGS: ClusterSettings = {
  threshold: 4,
  mode: "balanced",
  primaryBy: "volume",
  competitors: "",
  ignorePlatforms: true,
  weightTop: true,
};

/** Weight of a shared result by its 0-based position in the top 10. */
function positionWeight(position: number): number {
  if (position < 3) return 1.5;
  if (position < 6) return 1;
  return 0.75;
}

// A URL in hundreds of SERPs (a giant directory page) links unrelated
// keywords and makes pair counting quadratic, so it is ignored.
const MAX_SERPS_PER_URL = 300;

/** Balanced strict: tight while small, relaxed as a cluster grows. */
function requiredShare(mode: ClusterMode, size: number): number {
  if (mode === "strict") return 1;
  if (size <= 5) return 1;
  if (size <= 10) return 0.8;
  return 0.6;
}

/**
 * Pairwise overlap score between keywords: the shared top-10 URLs, each
 * counting 1, or by position when `weightTop` is on. SERP URLs are stored in
 * rank order, so a URL's index is its position.
 */
function overlapGraph(
  items: ClusterableKeyword[],
  options: Pick<ClusterOptions, "ignorePlatforms" | "weightTop">,
): Array<Map<number, number>> {
  const byUrl = new Map<string, Array<[number, number]>>();
  items.forEach((item, index) => {
    item.urls.forEach((url, position) => {
      if (options.ignorePlatforms && isPlatformDomain(urlDomain(url))) return;
      const list = byUrl.get(url);
      if (list) list.push([index, position]);
      else byUrl.set(url, [[index, position]]);
    });
  });
  const graph = items.map(() => new Map<number, number>());
  for (const list of byUrl.values()) {
    if (list.length < 2 || list.length > MAX_SERPS_PER_URL) continue;
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) {
        const [x, px] = list[a];
        const [y, py] = list[b];
        const score = options.weightTop
          ? (positionWeight(px) + positionWeight(py)) / 2
          : 1;
        graph[x].set(y, (graph[x].get(y) ?? 0) + score);
        graph[y].set(x, (graph[y].get(x) ?? 0) + score);
      }
    }
  }
  return graph;
}

function metric(item: ClusterableKeyword, by: ClusterPrimaryBy): number {
  const value = by === "cpc" ? item.cpc : item.volume;
  return value ?? -1;
}

/** `domain` is `parent` or one of its subdomains. */
export function isDomainOrSubdomain(domain: string, parent: string): boolean {
  const p = parent.toLowerCase().replace(/^www\./, "");
  return domain === p || domain.endsWith(`.${p}`);
}

function ranked(counts: Map<string, number>): Array<[string, number]> {
  return sort([...counts], (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function describeCluster(
  id: number,
  members: ClusterableKeyword[],
  ownDomain: string | null,
): KeywordCluster {
  const half = Math.max(2, Math.ceil(members.length / 2));
  const urlCounts = new Map<string, number>();
  const domainCounts = new Map<string, number>();
  const featureCounts = new Map<string, number>();
  const own = new Set<string>();
  for (const member of members) {
    const domains = new Set<string>();
    for (const url of member.urls) {
      urlCounts.set(url, (urlCounts.get(url) ?? 0) + 1);
      const domain = urlDomain(url);
      domains.add(domain);
      if (ownDomain && isDomainOrSubdomain(domain, ownDomain)) own.add(url);
    }
    for (const domain of domains)
      domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1);
    for (const feature of member.features)
      featureCounts.set(feature, (featureCounts.get(feature) ?? 0) + 1);
  }
  const sharedUrls =
    members.length < 2
      ? []
      : ranked(urlCounts)
          .filter(([, count]) => count >= half)
          .map(([url]) => url);
  const typeSource = sharedUrls.length ? sharedUrls : members[0].urls;
  const typeCounts = new Map<PageType, number>();
  for (const url of typeSource) {
    const type = pageTypeForUrl(url);
    typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
  }
  const pageType =
    sort([...typeCounts], (a, b) => b[1] - a[1])[0]?.[0] ?? "Other";
  const featureMin = Math.ceil(members.length / 2);
  return {
    id,
    main: members[0],
    keywords: members,
    totalVolume: members.reduce((sum, item) => sum + (item.volume ?? 0), 0),
    sharedUrls,
    topDomains: ranked(domainCounts)
      .slice(0, 5)
      .map(([domain, count]) => ({ domain, count })),
    pageType,
    features: ranked(featureCounts)
      .filter(([, count]) => count >= featureMin)
      .map(([feature]) => feature),
    ownUrls: sort([...own], (a, b) => a.localeCompare(b)),
  };
}

/**
 * Group keywords by shared top-10 URLs. Keywords are processed in order of
 * the primary metric, so each cluster's first keyword is its main keyword.
 * - soft: join if sharing `threshold` URLs with the cluster's main keyword.
 * - strict: join only if sharing `threshold` URLs with every member.
 * - balanced: strict while small, then 80% (6-10) and 60% (11+) of members.
 */
export function clusterKeywords(
  input: ClusterableKeyword[],
  options: ClusterOptions,
): KeywordCluster[] {
  const order = sort(
    input.map((item, index) => ({ item, index })),
    (a, b) =>
      metric(b.item, options.primaryBy) - metric(a.item, options.primaryBy) ||
      a.index - b.index,
  ).map(({ item }) => item);
  const graph = overlapGraph(order, options);
  const t = Math.max(1, options.threshold);
  const clusterOf = Array.from({ length: order.length }, () => -1);
  const groups: number[][] = [];

  for (let i = 0; i < order.length; i++) {
    if (clusterOf[i] !== -1) continue;
    if (options.mode === "soft") {
      const group = [i];
      clusterOf[i] = groups.length;
      for (const [j, count] of graph[i]) {
        if (count >= t && clusterOf[j] === -1) {
          clusterOf[j] = groups.length;
          group.push(j);
        }
      }
      groups.push(sort(group, (a, b) => a - b));
      continue;
    }
    // Candidate clusters: those holding a strong-enough neighbour, earliest
    // (highest metric) first.
    const candidates = new Set<number>();
    for (const [j, count] of graph[i])
      if (count >= t && clusterOf[j] !== -1) candidates.add(clusterOf[j]);
    let joined = -1;
    for (const c of sort([...candidates], (a, b) => a - b)) {
      const members = groups[c];
      const matches = members.filter((m) => (graph[i].get(m) ?? 0) >= t).length;
      const needed = Math.ceil(
        members.length * requiredShare(options.mode, members.length + 1),
      );
      if (matches >= needed) {
        joined = c;
        break;
      }
    }
    if (joined === -1) {
      clusterOf[i] = groups.length;
      groups.push([i]);
    } else {
      clusterOf[i] = joined;
      groups[joined].push(i);
    }
  }

  const ownDomain = options.ownDomain
    ? options.ownDomain.toLowerCase().replace(/^www\./, "")
    : null;
  return sort(
    groups.map((group, id) =>
      describeCluster(
        id,
        group.map((index) => order[index]),
        ownDomain,
      ),
    ),
    (a, b) =>
      b.totalVolume - a.totalVolume || b.keywords.length - a.keywords.length,
  );
}
