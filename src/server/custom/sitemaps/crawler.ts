import { XMLParser } from "fast-xml-parser";
import { z } from "zod";

export type SitemapSnapshot = {
  scannedAt: string;
  sitemapCount: number;
  urlCount: number;
  duplicateUrls: number;
  errors: string[];
  complete: boolean;
};

const LIMIT_SITEMAPS = 100;
const LIMIT_URLS = 100000;
const MAX_BYTES = 4 * 1024 * 1024;
const xmlRecord = z.record(z.string(), z.unknown());
const xmlArray = z.array(z.unknown());

function property(node: unknown, key: string): unknown {
  const value = xmlRecord.safeParse(node);
  return value.success ? value.data[key] : undefined;
}

function urlsFrom(node: unknown, key: string): string[] {
  const entry = property(node, key);
  const array = xmlArray.safeParse(entry);
  const items: unknown[] = array.success ? array.data : [entry];
  return items
    .map((item) => {
      if (typeof item === "string") return item;
      const loc = property(item, "loc");
      return typeof loc === "string" ? loc : "";
    })
    .filter(Boolean);
}

export function validateSitemapUrl(value: string, host: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.hostname.toLowerCase() !== host.toLowerCase()
  ) {
    throw new Error("Sitemap must use HTTPS on the configured project domain");
  }
  if (url.search.length > 300) throw new Error("Sitemap query string too long");
  return url.href;
}

function queueNestedSitemaps(
  index: unknown,
  host: string,
  seen: Set<string>,
  pending: string[],
  errors: string[],
): void {
  for (const child of urlsFrom(index, "sitemap")) {
    try {
      const verified = validateSitemapUrl(child, host);
      if (!seen.has(verified) && !pending.includes(verified))
        pending.push(verified);
    } catch {
      errors.push("Ignored off-domain or unsafe nested sitemap URL");
    }
  }
}

function collectPages(
  urlset: unknown,
  host: string,
  pageUrls: Set<string>,
  errors: string[],
): number {
  let duplicates = 0;
  for (const page of urlsFrom(urlset, "url")) {
    try {
      const url = new URL(page);
      if (
        url.hostname.toLowerCase() !== host.toLowerCase() ||
        !["https:", "http:"].includes(url.protocol)
      )
        continue;
      if (pageUrls.has(url.href)) duplicates++;
      else pageUrls.add(url.href);
      if (pageUrls.size >= LIMIT_URLS) break;
    } catch {
      errors.push("Skipped invalid page URL");
    }
  }
  return duplicates;
}

async function fetchSitemapXml(
  url: string,
  fetcher: typeof fetch,
): Promise<unknown> {
  // Resolve redirects explicitly so no off-domain request is followed.
  const sourceHost = new URL(url).hostname;
  let current = url;
  let response: Response | undefined;
  for (let hop = 0; hop < 4; hop++) {
    response = await fetcher(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(12000),
      headers: { Accept: "application/xml,text/xml" },
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get("location");
    if (!location) throw new Error(`HTTP ${response.status} missing Location header`);
    current = validateSitemapUrl(new URL(location, current).href, sourceHost);
    if (hop === 3) throw new Error("Too many sitemap redirects");
  }
  if (!response) throw new Error("No sitemap response");
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const claimed = Number(response.headers.get("content-length") ?? 0);
  if (claimed > MAX_BYTES) throw new Error("Sitemap exceeds size limit");
  const body = await response.text();
  if (body.length > MAX_BYTES) throw new Error("Sitemap exceeds size limit");
  const parser = new XMLParser({
    ignoreAttributes: true,
    processEntities: false,
  });
  const parsed: unknown = parser.parse(body);
  if (!xmlRecord.safeParse(parsed).success)
    throw new Error("Invalid XML sitemap");
  return parsed;
}

export async function crawlSitemaps(
  host: string,
  root: string,
  fetcher: typeof fetch = fetch,
): Promise<SitemapSnapshot> {
  const scannedAt = new Date().toISOString();
  const pending = [validateSitemapUrl(root, host)];
  const seen = new Set<string>();
  const pageUrls = new Set<string>();
  const errors: string[] = [];
  let duplicateUrls = 0;
  while (
    pending.length &&
    seen.size < LIMIT_SITEMAPS &&
    pageUrls.size < LIMIT_URLS
  ) {
    const next = pending.shift();
    if (!next || seen.has(next)) continue;
    seen.add(next);
    try {
      const parsed = await fetchSitemapXml(next, fetcher);
      const index = property(parsed, "sitemapindex");
      const urlset = property(parsed, "urlset");
      if (index) queueNestedSitemaps(index, host, seen, pending, errors);
      else if (urlset)
        duplicateUrls += collectPages(urlset, host, pageUrls, errors);
      else throw new Error("XML is not a sitemapindex or urlset");
    } catch (error) {
      errors.push(
        `${next}: ${error instanceof Error ? error.message : "Failed"}`,
      );
    }
  }
  const complete =
    pending.length === 0 && pageUrls.size < LIMIT_URLS && errors.length === 0;
  return {
    scannedAt,
    sitemapCount: seen.size,
    urlCount: pageUrls.size,
    duplicateUrls,
    errors: errors.slice(0, 20),
    complete,
  };
}
