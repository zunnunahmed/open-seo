import { z } from "zod";
import {
  callSerpstat,
  databaseFor,
  keywordRowSchema,
  labsKeyword,
  ROW_USD,
  rows,
  size,
  text,
  unsupported,
  type Answer,
  type Task,
} from "@/server/custom/providers/treg/serpstatClient";

/** Domain Overview handlers of the treg → Serpstat adapter. */

const DOMAIN_INFO_USD = 0.0025;
// treg relays any Serpstat domain method on this endpoint (all share "/").
const DOMAIN = "serpstat.google.domain.ranked_keywords";
const DOMAIN_INFO = "serpstat.google.domain.overview";

/** Leaf conditions of a DataForSEO filter expression. */
function filterLeaves(expression: unknown): unknown[][] {
  if (!Array.isArray(expression)) return [];
  if (typeof expression[0] === "string" && expression.length === 3)
    return [expression];
  return expression.flatMap((part) =>
    typeof part === "string" ? [] : filterLeaves(part),
  );
}

const NO_FILTERS =
  "column filters, search and subfolder or URL scopes are not available";

const rankedRowSchema = keywordRowSchema.extend({
  url: z.string(),
  position: z.number(),
  traff: z.number().nullish(),
});

const RANKED_SORT: Record<string, string> = {
  "keyword_data.keyword_info.search_volume": "region_queries_count",
  "ranked_serp_element.serp_item.etv": "traff",
  "ranked_serp_element.serp_item.rank_absolute": "position",
  "keyword_data.keyword_info.cpc": "cost",
  "keyword_data.keyword_properties.keyword_difficulty": "difficulty",
};

/** Serpstat sort object from the first DataForSEO order_by rule. */
function sortFor(task: Task, fields: Record<string, string>) {
  const rule: unknown = Array.isArray(task.order_by)
    ? task.order_by[0]
    : undefined;
  if (typeof rule !== "string") return undefined;
  const [field, direction] = rule.split(",");
  const serpstatField = fields[field];
  if (!serpstatField) unsupported(`sorting by ${field} is not available`);
  return { [serpstatField]: direction === "asc" ? "asc" : "desc" };
}

function pageFor(task: Task) {
  const limit = size(task);
  const offset = typeof task.offset === "number" ? task.offset : 0;
  return { size: limit, page: Math.floor(offset / limit) + 1 };
}

export async function rankedKeywords(task: Task): Promise<Answer> {
  // The only filter honoured is the "domain" scope host pin, which Serpstat
  // expresses as withSubdomains: false.
  const leaves = filterLeaves(task.filters);
  if (
    leaves.some(
      ([field, op]) =>
        field !== "ranked_serp_element.serp_item.domain" || op !== "in",
    )
  )
    unsupported(NO_FILTERS);
  const { data, total } = await callSerpstat(
    DOMAIN,
    "SerpstatDomainProcedure.getDomainKeywords",
    {
      domain: text(task.target),
      se: databaseFor(task),
      withSubdomains: leaves.length === 0,
      withIntents: true,
      sort: sortFor(task, RANKED_SORT),
      ...pageFor(task),
    },
  );
  const list = rows(rankedRowSchema, data);
  return {
    result: [
      {
        total_count: total,
        items: list.map((row) => ({
          keyword_data: labsKeyword(row),
          ranked_serp_element: {
            serp_item: {
              url: row.url,
              rank_absolute: row.position,
              etv: row.traff ?? null,
            },
          },
        })),
      },
    ],
    cost: Math.max(1, list.length) * ROW_USD,
  };
}

const topUrlSchema = z.object({
  url: z.string(),
  organic_keywords: z.number().nullish(),
  potencial_traff: z.number().nullish(),
});

const PAGES_SORT: Record<string, string> = {
  "metrics.organic.etv": "potencial_traff",
  "metrics.organic.count": "organic_keywords",
};

export async function relevantPages(task: Task): Promise<Answer> {
  // The "domain" scope arrives as page_address host patterns; keep only
  // those hosts. Anything else is a filter Serpstat can't apply.
  const hosts = new Set<string>();
  for (const [field, op, value] of filterLeaves(task.filters)) {
    const host =
      field === "page_address" && op === "like" && typeof value === "string"
        ? /^%:\/\/(.+)\/%$/.exec(value)?.[1]
        : undefined;
    if (!host) unsupported(NO_FILTERS);
    hosts.add(host.replace(/\\(.)/g, "$1"));
  }
  const { data, total } = await callSerpstat(
    DOMAIN,
    "SerpstatDomainProcedure.getTopUrls",
    {
      domain: text(task.target),
      se: databaseFor(task),
      sort: sortFor(task, PAGES_SORT),
      ...pageFor(task),
    },
  );
  const list = rows(topUrlSchema, data);
  const items = list
    .filter((row) => hosts.size === 0 || hosts.has(new URL(row.url).hostname))
    .map((row) => ({
      page_address: row.url,
      metrics: {
        organic: {
          etv: row.potencial_traff ?? null,
          count: row.organic_keywords ?? null,
        },
      },
    }));
  return {
    result: [{ total_count: total, items }],
    cost: Math.max(1, list.length) * ROW_USD,
  };
}

const domainInfoSchema = z.object({
  keywords: z.number().nullish(),
  traff: z.number().nullish(),
});

export async function domainOverview(task: Task): Promise<Answer> {
  const { data } = await callSerpstat(
    DOMAIN_INFO,
    "SerpstatDomainProcedure.getDomainsInfo",
    { domains: [text(task.target)], se: databaseFor(task) },
  );
  const [info] = rows(domainInfoSchema, data);
  return {
    result: [
      {
        items: info
          ? [
              {
                metrics: { organic: { etv: info.traff, count: info.keywords } },
              },
            ]
          : [],
      },
    ],
    cost: DOMAIN_INFO_USD,
  };
}
