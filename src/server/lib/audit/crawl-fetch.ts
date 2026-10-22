/**
 * One crawl request: manual redirects (each hop is its own page row) and a
 * 15 s deadline.
 *
 * On Workers Free a Workflow instance gets 50 subrequests for its whole run,
 * so the crawl sends page fetches through the audit's scratchpad Durable
 * Object (AuditScratchpad.crawlFetch): each call there is its own invocation
 * with its own budget. Tests and other callers fetch directly.
 */
export type CrawlFetch = (
  url: string,
  headers: Record<string, string>,
) => Promise<Response>;

const CRAWL_FETCH_TIMEOUT_MS = 15_000;

export const directCrawlFetch: CrawlFetch = (url, headers) =>
  fetch(url, {
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(CRAWL_FETCH_TIMEOUT_MS),
  });
