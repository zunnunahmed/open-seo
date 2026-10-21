import { XMLParser } from "fast-xml-parser";

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

function urlsFrom(node: unknown, key: string): string[] {
  if (typeof node !== "object" || node === null) return [];
  const entry = (node as Record<string, unknown>)[key];
  const arr = Array.isArray(entry) ? entry : [entry];
  return arr
    .map((item) => {
      if (typeof item === "string") return item;
      if (typeof item === "object" && item !== null) {
        const loc = (item as Record<string, unknown>).loc;
        return typeof loc === "string" ? loc : "";
      }
      return "";
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
  )
    throw new Error("Sitemap must use HTTPS on the configured project domain");
  if (url.search.length > 300) return "";
  return url.href;
}
export async function crawlSitemaps(
  host: string,
  root: string,
  fetcher: typeof fetch = fetch,
): Promise<SitemapSnapshot> {
  const scannedAt = new Date().toISOString();
  const parser = new XMLParser({
    ignoreAttributes: true,
    processEntities: false,
  });
  const pending = [validateSitemapUrl(root, host)];
  const seen = new Set<string>();
  const pageUrls = new Set<string>();
  let duplicateUrls = 0;
  const errors: string[] = [];
  while (
    pending.length &&
    seen.size < LIMIT_SITEMAPS &&
    pageUrls.size < LIMIT_URLS
  ) {
    const next = pending.shift();
    if (!next || seen.has(next)) continue;
    seen.add(next);
    try {
      const response = await fetcher(next, {
        redirect: "error",
        signal: AbortSignal.timeout(12000),
        headers: { Accept: "application/xml,text/xml" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const claimed = Number(response.headers.get("content-length") ?? 0);
      if (claimed > MAX_BYTES) throw new Error("Sitemap exceeds size limit");
      const body = await response.text();
      if (body.length > MAX_BYTES)
        throw new Error("Sitemap exceeds size limit");
      const parsed = parser.parse(body) as unknown;
      if (!parsed || typeof parsed !== "object")
        throw new Error("Invalid XML sitemap");
      const object = parsed as Record<string, unknown>;
      const index = object.sitemapindex;
      const urlset = object.urlset;
      if (index) {
        const children = urlsFrom(index, "sitemap");
        for (const child of children) {
          try {
            const verified = validateSitemapUrl(child, host);
            if (!seen.has(verified) && !pending.includes(verified))
              pending.push(verified);
          } catch {
            errors.push("Ignored off-domain or unsafe nested sitemap URL");
          }
        }
      } else if (urlset) {
        const found = urlsFrom(urlset, "url");
        for (const page of found) {
          try {
            const u = new URL(page);
            if (
              u.hostname.toLowerCase() !== host.toLowerCase() ||
              !["https:", "http:"].includes(u.protocol)
            )
              continue;
            if (pageUrls.has(u.href)) duplicateUrls++;
            else pageUrls.add(u.href);
            if (pageUrls.size >= LIMIT_URLS) break;
          } catch {
            errors.push("Skipped invalid page URL");
          }
        }
      } else {
        throw new Error("XML is not a sitemapindex or urlset");
      }
    } catch (err) {
      errors.push(`${next}: ${err instanceof Error ? err.message : "Failed"}`);
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
