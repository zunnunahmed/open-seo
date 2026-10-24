import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  GscNotConnectedError,
  GscService,
  isExpectedGrantFailure,
} from "@/server/features/gsc/services/GscService";
import {
  resolveDateRange,
  type GscPerformanceFilter,
} from "@/server/features/gsc/searchAnalytics";
import { lastTwelveMonths } from "@/server/features/gsc/pageMonths";
import { requireProjectContext } from "@/serverFunctions/middleware";
import { searchPerformanceInputSchema } from "@/types/schemas/search-performance";

/** Google's largest Search Analytics page; a month above it shows "25,000+". */
const QUERY_ROW_LIMIT = 25_000;

/**
 * One page from GSC Insights: its URL Inspection result, every query Google
 * showed it for in the selected range, and its query count for each of the
 * last 12 months. First-party Search Console data, free.
 */
export const getGscPageDetail = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    searchPerformanceInputSchema
      .omit({ pageFilter: true, queryFilter: true })
      .extend({ page: z.string().url().max(2048) }),
  )
  .handler(async ({ data, context }) => {
    const projectId = context.projectId;
    // Device and country follow the report; the page is this page exactly.
    const filters: GscPerformanceFilter[] = [
      { dimension: "page", operator: "equals", expression: data.page },
      ...(data.device
        ? [
            {
              dimension: "device" as const,
              operator: "equals" as const,
              expression: data.device,
            },
          ]
        : []),
      ...(data.country
        ? [
            {
              dimension: "country" as const,
              operator: "equals" as const,
              expression: data.country,
            },
          ]
        : []),
    ];
    const { startDate, endDate } = resolveDateRange({
      dateRange: data.dateRange,
    });
    const queriesFor = (range: { startDate: string; endDate: string }) =>
      GscService.getPerformance({
        projectId,
        ...range,
        dimensions: ["query"],
        filters,
        rowLimit: QUERY_ROW_LIMIT,
      });

    try {
      const [inspection, current, ...monthly] = await Promise.all([
        // An inspection failure (quota, URL outside the property) must not
        // hide the query data, so it is reported on its own.
        GscService.inspectUrls({ projectId, urls: [data.page] }).then(
          (result) => result.results[0] ?? null,
          (error: unknown) => {
            if (isExpectedGrantFailure(error)) throw error;
            return {
              url: data.page,
              result: null,
              error:
                error instanceof Error ? error.message : "Inspection failed",
            };
          },
        ),
        queriesFor({ startDate, endDate }),
        ...lastTwelveMonths(new Date()).map(async (month) => {
          const { rows } = await queriesFor(month);
          return {
            month: month.month,
            partial: month.partial,
            queries: rows.length,
            capped: rows.length >= QUERY_ROW_LIMIT,
            clicks: rows.reduce((sum, row) => sum + row.clicks, 0),
            impressions: rows.reduce((sum, row) => sum + row.impressions, 0),
          };
        }),
      ]);
      const queries = current.rows.map((row) => ({
        query: row.keys?.[0] ?? "",
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: row.ctr,
        position: row.position,
      }));
      return {
        connected: true as const,
        range: { startDate, endDate },
        inspection,
        queries,
        queryCount: queries.length,
        queriesCapped: queries.length >= QUERY_ROW_LIMIT,
        months: monthly,
      };
    } catch (error) {
      if (
        error instanceof GscNotConnectedError ||
        isExpectedGrantFailure(error)
      )
        return { connected: false as const };
      throw error;
    }
  });
