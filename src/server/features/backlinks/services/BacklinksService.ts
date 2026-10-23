import { z } from "zod";
import { activeSeoProviderRoute } from "@/server/custom/providers/treg/dataforseoTransport";
import { buildCacheKey, getCached, setCached } from "@/server/lib/r2-cache";
import { normalizeBacklinksTarget } from "@/server/lib/dataforseo";
import type {
  BacklinksLookupInput,
  BacklinksSpamFilterOptions,
} from "@/types/schemas/backlinks";
import {
  profileBacklinksOverview,
  profileBacklinksRowsPage,
  profileReferringDomainsPage,
  profileTopPagesPage,
  type BacklinksCache,
  type BacklinksRowsPageServiceInput,
  type ReferringDomainsPageServiceInput,
  type TopPagesPageServiceInput,
} from "@/server/features/backlinks/services/backlinksServiceData";
import type { BillingCustomerContext } from "@/server/billing/subscription";
import type { CreditFeature } from "@/shared/billing-credit-features";

const defaultCache: BacklinksCache = {
  get: getCached,
  set: setCached,
};

type BacklinksPageCacheInput = {
  target: string;
  scope?: BacklinksLookupInput["scope"];
  page: number;
  pageSize: number;
  sortField: string;
  sortOrder: string;
  filters: Record<string, unknown>;
  /** Backlinks rows only: DataForSEO result grouping. */
  mode?: string;
};

function createBacklinksService(cache: BacklinksCache = defaultCache) {
  return {
    async profileOverview(
      input: BacklinksLookupInput,
      billingCustomer: BillingCustomerContext,
      // Lets a caller (e.g. the SAM agent) attribute the spend to its own credit
      // feature. Applied to the DataForSEO calls, not the cache key, so cached
      // results stay shared across callers.
      creditFeature?: CreditFeature,
    ) {
      const cacheKey = await buildCacheKey("backlinks:overview:v2", {
        ...(await buildTargetCacheInput(cache, input, billingCustomer)),
      });

      return profileBacklinksOverview(
        cache,
        cacheKey,
        input,
        billingCustomer,
        creditFeature,
      );
    },
    async profileBacklinksPage(
      input: BacklinksRowsPageServiceInput,
      billingCustomer: BillingCustomerContext,
      options?: BacklinksSpamFilterOptions,
    ) {
      const cacheKey = await buildPageCacheKey(
        cache,
        "backlinks:rows-page:v2",
        input,
        billingCustomer,
        options,
      );

      return profileBacklinksRowsPage(
        cache,
        cacheKey,
        input,
        billingCustomer,
        options,
      );
    },
    async profileReferringDomainsPage(
      input: ReferringDomainsPageServiceInput,
      billingCustomer: BillingCustomerContext,
      options?: BacklinksSpamFilterOptions,
    ) {
      const cacheKey = await buildPageCacheKey(
        cache,
        "backlinks:referring-domains-page",
        input,
        billingCustomer,
        options,
      );

      return profileReferringDomainsPage(
        cache,
        cacheKey,
        input,
        billingCustomer,
        options,
      );
    },
    async profileTopPagesPage(
      input: TopPagesPageServiceInput,
      billingCustomer: BillingCustomerContext,
    ) {
      const cacheKey = await buildPageCacheKey(
        cache,
        "backlinks:top-pages-page",
        input,
        billingCustomer,
      );

      return profileTopPagesPage(cache, cacheKey, input, billingCustomer);
    },
    /**
     * Retire every saved result for this target (all tabs, sorts and
     * filters) so the next requests fetch fresh, paid data.
     */
    async markRefreshed(
      input: BacklinksLookupInput,
      billingCustomer: BillingCustomerContext,
    ) {
      await cache.set(
        refreshMarkerKey(input, billingCustomer),
        new Date().toISOString(),
        REFRESH_MARKER_TTL_SECONDS,
      );
    },
  } as const;
}

// Outlives every saved result it retires (results are kept 28 days).
const REFRESH_MARKER_TTL_SECONDS = 60 * 24 * 60 * 60;

function refreshMarkerKey(
  input: BacklinksLookupInput,
  billingCustomer: BillingCustomerContext,
) {
  const target = normalizeBacklinksTarget(input.target, { scope: input.scope });
  return `backlinks:refreshed:${billingCustomer.organizationId}:${target.apiTarget}`;
}

async function buildTargetCacheInput(
  cache: BacklinksCache,
  input: BacklinksLookupInput,
  billingCustomer: BillingCustomerContext,
) {
  const normalizedTarget = normalizeBacklinksTarget(input.target, {
    scope: input.scope,
  });
  const refreshed = z
    .string()
    .safeParse(await cache.get(refreshMarkerKey(input, billingCustomer)));

  return {
    // A refresh moves the target to new keys; absent, keys are unchanged.
    ...(refreshed.success ? { refreshedAt: refreshed.data } : {}),
    organizationId: billingCustomer.organizationId,
    providerRoute: activeSeoProviderRoute(),
    target: normalizedTarget.apiTarget,
    scope: normalizedTarget.scope,
    // Subfolder scope keeps the hostname as the API target, so the path must
    // separate cache entries.
    path: normalizedTarget.path,
    // Same hostname, different result set — and keeping it in the key retires
    // entries written before scopes could exclude subdomains.
    includeSubdomains: normalizedTarget.includeSubdomains,
  };
}

async function buildPageCacheKey(
  cache: BacklinksCache,
  prefix: string,
  input: BacklinksPageCacheInput,
  billingCustomer: BillingCustomerContext,
  options?: BacklinksSpamFilterOptions,
): Promise<string> {
  return buildCacheKey(prefix, {
    ...(await buildTargetCacheInput(cache, input, billingCustomer)),
    page: input.page,
    pageSize: input.pageSize,
    sortField: input.sortField,
    sortOrder: input.sortOrder,
    filters: input.filters,
    ...(input.mode ? { mode: input.mode } : {}),
    hideSpam: String(options?.hideSpam ?? true),
  });
}

export const BacklinksService = createBacklinksService();
export { createBacklinksService };
