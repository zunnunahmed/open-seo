import { z } from "zod";
import type { createDataforseoClient } from "@/server/lib/dataforseo";
import { getFromTreg } from "@/server/custom/providers/treg/dataforseoTransport";
import { getIsoCountryCode } from "@/shared/keyword-locations";
import { domainAuthority } from "./authority";
import type { NewProspect } from "./OutreachRepository";

type Client = ReturnType<typeof createDataforseoClient>;

/**
 * Where outreach prospects come from: sites linking to competitors but not
 * to the project (link gap), sites inviting contributions (guest posts), and
 * publications covering a topic (PR). Platforms nobody pitches for a link are
 * dropped.
 */
const PLATFORMS = [
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "twitter.com",
  "x.com",
  "youtube.com",
  "pinterest.com",
  "reddit.com",
  "quora.com",
  "medium.com",
  "wikipedia.org",
  "tiktok.com",
  "github.com",
  "google.com",
  "amazon.com",
  "apple.com",
  "wordpress.org",
  "blogspot.com",
  "tumblr.com",
];

/**
 * Sites that don't answer link outreach: government and military, and giant
 * publishers and platforms whose editors never place links on request.
 */
const UNPITCHABLE_DOMAINS = [
  "forbes.com",
  "nytimes.com",
  "washingtonpost.com",
  "wsj.com",
  "bbc.com",
  "bbc.co.uk",
  "cnn.com",
  "theguardian.com",
  "reuters.com",
  "bloomberg.com",
  "businessinsider.com",
  "huffpost.com",
  "usatoday.com",
  "foxnews.com",
  "nbcnews.com",
  "cbsnews.com",
  "abc.net.au",
  "news.com.au",
  "smh.com.au",
  "yahoo.com",
  "msn.com",
  "google.com",
  "blog.google",
  "youtube.com",
  "wikipedia.org",
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "twitter.com",
  "x.com",
  "tiktok.com",
  "pinterest.com",
  "reddit.com",
  "quora.com",
  "medium.com",
  "amazon.com",
  "apple.com",
  "microsoft.com",
  "github.com",
  "wordpress.org",
  "wordpress.com",
  "blogspot.com",
];

/** True for .gov/.mil sites (also gov.au style) and the giants above. */
export function isUnpitchableDomain(domain: string): boolean {
  const host = bareDomain(domain) ?? domain.toLowerCase();
  if (/(^|\.)(gov|mil)(\.[a-z]{2})?$/.test(host)) return true;
  return UNPITCHABLE_DOMAINS.some(
    (giant) => host === giant || host.endsWith(`.${giant}`),
  );
}

export function bareDomain(value: string): string | null {
  const text = value.trim().toLowerCase();
  if (!text) return null;
  try {
    const host = new URL(text.includes("://") ? text : `https://${text}`)
      .hostname;
    return host.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

function isPitchable(domain: string, excluded: Set<string>): boolean {
  return ![...PLATFORMS, ...excluded].some(
    (blocked) => domain === blocked || domain.endsWith(`.${blocked}`),
  );
}

/** Referring domains of each competitor that do not link to the project. */
export async function linkGapProspects(
  client: Client,
  competitors: string[],
  ownDomain: string | null,
): Promise<NewProspect[]> {
  const referring = async (target: string) =>
    (
      await client.backlinks.referringDomains({
        target,
        limit: 1000,
        orderBy: ["rank,desc"],
      })
    ).items;
  const own = new Set(
    ownDomain
      ? (await referring(ownDomain)).flatMap((row) =>
          row.domain ? [bareDomain(row.domain) ?? row.domain] : [],
        )
      : [],
  );
  const excluded = new Set([ownDomain ?? "", ...competitors].filter(Boolean));
  const prospects = new Map<string, NewProspect>();
  for (const competitor of competitors) {
    for (const row of await referring(competitor)) {
      const domain = row.domain ? bareDomain(row.domain) : null;
      if (!domain || own.has(domain) || prospects.has(domain)) continue;
      if (!isPitchable(domain, excluded)) continue;
      prospects.set(domain, {
        domain,
        source: "link_gap",
        sourceDetail: competitor,
        authority: row.rank ?? null,
      });
    }
  }
  return [...prospects.values()];
}

/** Articles about guest posting (advice, lists of sites), not invitations. */
const ADVICE_TITLE =
  /\b(how to|tips|ways to|guide to|top \d+|\d+ (best|top)|list of|best .*sites|sites (that|to|for)|websites (that|to|for))\b/i;

type Market = { locationCode: number; languageCode: string };

type SerpFilters = {
  /** Only sites on these domain endings, e.g. ["au", "nz"]; [] for any. */
  endings: string[];
  /** Drop sites above this authority (0-100); big brands rarely say yes. */
  maxAuthority: number;
};

/**
 * Run every search at once and keep what succeeded: one slow or failed
 * search must not lose the others. Fails only when all of them failed.
 */
async function settleAll<T>(runs: Array<() => Promise<T>>): Promise<T[]> {
  const settled = await Promise.allSettled(runs.map((run) => run()));
  const ok = settled.flatMap((outcome) =>
    outcome.status === "fulfilled" ? [outcome.value] : [],
  );
  const failed = settled.find((outcome) => outcome.status === "rejected");
  if (ok.length === 0 && failed) throw failed.reason;
  return ok;
}

/** " site:.au" or " (site:.au OR site:.nz)" for the chosen endings. */
function siteRestriction(endings: string[]): string {
  const sites = endings.map((ending) => `site:.${ending}`);
  if (sites.length === 0) return "";
  return sites.length === 1 ? ` ${sites[0]}` : ` (${sites.join(" OR ")})`;
}

/**
 * Websites ranking in Google for each query, deduplicated, rated for
 * authority and capped at the maximum.
 */
async function serpProspects(
  client: Client,
  input: {
    queries: Array<{ query: string; label: string }>;
    market: Market;
    excluded: Set<string>;
    filters: SerpFilters;
    depth: number;
    source: NewProspect["source"];
    skipTitle?: RegExp;
  },
): Promise<NewProspect[]> {
  const restrict = siteRestriction(input.filters.endings);
  const results = await settleAll(
    input.queries.map(({ query, label }) => async () => ({
      label,
      items: await client.serp.live({
        keyword: `${query}${restrict}`,
        locationCode: input.market.locationCode,
        languageCode: input.market.languageCode,
        depth: input.depth,
      }),
    })),
  );
  const prospects = new Map<string, NewProspect>();
  for (const { label, items } of results) {
    for (const item of items) {
      if (item.type !== "organic" || !item.url) continue;
      if (item.title && input.skipTitle?.test(item.title)) continue;
      const domain = bareDomain(item.url);
      if (
        !domain ||
        prospects.has(domain) ||
        !isPitchable(domain, input.excluded)
      )
        continue;
      prospects.set(domain, {
        domain,
        source: input.source,
        sourceDetail: label,
        sourceUrl: item.url,
        sourceTitle: item.title ?? null,
      });
    }
  }
  const authority = await domainAuthority([...prospects.keys()]);
  return [...prospects.values()].flatMap((prospect) => {
    const score = authority.get(prospect.domain) ?? null;
    if (score !== null && score > input.filters.maxAuthority) return [];
    return [{ ...prospect, authority: score }];
  });
}

/** Sites inviting guest posts, from the chosen Google phrases per topic. */
export function guestPostProspects(
  client: Client,
  queries: string[],
  market: Market,
  excludedDomains: string[],
  filters: SerpFilters = { endings: [], maxAuthority: 100 },
): Promise<NewProspect[]> {
  return serpProspects(client, {
    queries: queries.map((query) => ({ query, label: query })),
    market,
    excluded: new Set(excludedDomains),
    filters,
    depth: 20,
    source: "guest_post",
    skipTitle: ADVICE_TITLE,
  });
}

/** The websites ranking for any Google search, as leads (10-100 each). */
export function searchProspects(
  client: Client,
  terms: string[],
  market: Market,
  excludedDomains: string[],
  filters: SerpFilters & { depth: number },
): Promise<NewProspect[]> {
  return serpProspects(client, {
    queries: terms.map((term) => ({ query: term, label: term })),
    market,
    excluded: new Set(excludedDomains),
    filters,
    depth: filters.depth,
    source: "search",
  });
}

const newsSchema = z.object({
  results: z.array(
    z
      .object({
        url: z.string(),
        title: z.string().nullish(),
        publisher: z.string().nullish(),
      })
      .passthrough(),
  ),
});

/**
 * Two angles per topic: outlets covering it, and articles quoting experts on
 * it, which are the likeliest to quote you next.
 */
const PR_ANGLES = ["", " experts say"];

/** Press-release wires publish anything paid for; nobody there takes pitches. */
const PRESS_WIRES = [
  "prnewswire.com",
  "businesswire.com",
  "globenewswire.com",
  "einpresswire.com",
  "accesswire.com",
  "newswire.com",
  "openpr.com",
  "prweb.com",
];

/** Publications in one country that covered each topic in the last year. */
export async function prProspects(
  topics: string[],
  market: Market,
  excludedDomains: string[],
): Promise<NewProspect[]> {
  const excluded = new Set([...excludedDomains, ...PRESS_WIRES]);
  const country = getIsoCountryCode(market.locationCode).toUpperCase();
  const since = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const searches = topics.flatMap((topic) =>
    PR_ANGLES.map((angle) => ({ topic, query: `${topic}${angle}` })),
  );
  const results = await settleAll(
    searches.map(({ topic, query }) => async () => {
      const response = await getFromTreg("tinyfish.web.search.news", {
        query,
        domain_type: "news",
        location: country,
        language: market.languageCode,
        after_date: since,
      });
      return { topic, body: (await response.json()) as unknown };
    }),
  );
  const prospects = new Map<string, NewProspect>();
  for (const { topic, body } of results) {
    const parsed = newsSchema.safeParse(body);
    if (!parsed.success) continue;
    for (const article of parsed.data.results) {
      const domain = bareDomain(article.url);
      if (!domain || prospects.has(domain) || !isPitchable(domain, excluded))
        continue;
      prospects.set(domain, {
        domain,
        source: "pr",
        sourceDetail: topic,
        sourceUrl: article.url,
        sourceTitle: article.title ?? article.publisher ?? null,
      });
    }
  }
  // Big outlets are the point in PR, so the score only helps sort them.
  const authority = await domainAuthority([...prospects.keys()]);
  return [...prospects.values()].map((prospect) => ({
    ...prospect,
    authority: authority.get(prospect.domain) ?? null,
  }));
}
