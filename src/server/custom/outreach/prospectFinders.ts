import { z } from "zod";
import type { createDataforseoClient } from "@/server/lib/dataforseo";
import { getFromTreg } from "@/server/custom/providers/treg/dataforseoTransport";
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

/** Google footprints for sites that publish outside contributions. */
const GUEST_POST_FOOTPRINTS = [
  '"write for us"',
  '"guest post"',
  '"contribute" OR "submit an article"',
];

export async function guestPostProspects(
  client: Client,
  topics: string[],
  market: { locationCode: number; languageCode: string },
  excludedDomains: string[],
): Promise<NewProspect[]> {
  const excluded = new Set(excludedDomains);
  const prospects = new Map<string, NewProspect>();
  for (const topic of topics) {
    for (const footprint of GUEST_POST_FOOTPRINTS) {
      const query = `${topic} ${footprint}`;
      const items = await client.serp.live({
        keyword: query,
        locationCode: market.locationCode,
        languageCode: market.languageCode,
        depth: 20,
      });
      for (const item of items) {
        if (item.type !== "organic" || !item.url) continue;
        const domain = bareDomain(item.url);
        if (!domain || prospects.has(domain) || !isPitchable(domain, excluded))
          continue;
        prospects.set(domain, {
          domain,
          source: "guest_post",
          sourceDetail: query,
          sourceUrl: item.url,
          sourceTitle: item.title ?? null,
        });
      }
    }
  }
  return [...prospects.values()];
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

/** Publications that recently covered each topic (TinyFish news, free). */
export async function prProspects(
  topics: string[],
  excludedDomains: string[],
): Promise<NewProspect[]> {
  const excluded = new Set(excludedDomains);
  const prospects = new Map<string, NewProspect>();
  for (const topic of topics) {
    const response = await getFromTreg("tinyfish.web.search.news", {
      query: topic,
      domain_type: "news",
    });
    const parsed = newsSchema.safeParse(await response.json());
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
  return [...prospects.values()];
}
