import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  requireBacklinksSeoRoute,
  requireProjectContext,
  requireProjectSeoRoute,
} from "@/serverFunctions/middleware";
import { createDataforseoClient } from "@/server/lib/dataforseo";
import { OutreachRepository } from "@/server/custom/outreach/OutreachRepository";
import {
  bareDomain,
  guestPostProspects,
  linkGapProspects,
  prProspects,
  searchProspects,
} from "@/server/custom/outreach/prospectFinders";
import {
  keepUnsuppressed,
  ownDomain,
} from "@/server/custom/outreach/prospectScope";
import {
  GUEST_POST_FOOTPRINTS,
  guestPostQueries,
  isFootprintId,
} from "@/shared/outreachFootprints";

/**
 * Outreach → Link Prospects, step 1: the searches that add prospects (link
 * gap, guest posts, Google search, PR).
 */
const projectInput = z.object({ projectId: z.string().min(1) });
const topicsInput = z.array(z.string().trim().min(2).max(80)).min(1).max(5);
/** The country to search; the project's market when left out. */
const marketInput = {
  locationCode: z.number().int().positive().optional(),
  languageCode: z.string().min(2).max(10).optional(),
};

function marketOf(
  project: { locationCode: number; languageCode: string },
  data: { locationCode?: number; languageCode?: string },
) {
  return {
    locationCode: data.locationCode ?? project.locationCode,
    languageCode: data.languageCode ?? project.languageCode,
  };
}

/** Sites linking to 1–3 competitors but not to the project (paid backlinks data). */
export const findLinkGapProspects = createServerFn({ method: "POST" })
  .middleware(requireBacklinksSeoRoute)
  .validator(
    projectInput.extend({
      competitors: z.array(z.string().trim().min(3).max(253)).min(1).max(3),
    }),
  )
  .handler(async ({ data, context }) => {
    const competitors = data.competitors.flatMap((value) => {
      const domain = bareDomain(value);
      return domain ? [domain] : [];
    });
    const prospects = await keepUnsuppressed(
      context.projectId,
      await linkGapProspects(
        createDataforseoClient(context),
        competitors,
        ownDomain(context.project),
      ),
    );
    await OutreachRepository.addProspects(context.projectId, prospects);
    return { found: prospects.length };
  });

/** Domain endings without the dot, e.g. "au" or "com.au", and an authority cap. */
const serpFiltersInput = {
  endings: z
    .array(z.string().regex(/^[a-z0-9-]+(\.[a-z0-9-]+)*$/))
    .max(5)
    .default([]),
  maxAuthority: z.number().int().min(1).max(100).default(60),
};

/** Sites inviting guest posts: the chosen phrases per topic, up to 20 searches. */
export const findGuestPostProspects = createServerFn({ method: "POST" })
  .middleware(requireProjectSeoRoute)
  .validator(
    projectInput.extend({
      topics: topicsInput,
      ...marketInput,
      ...serpFiltersInput,
      footprints: z.array(z.string()).max(GUEST_POST_FOOTPRINTS.length),
      customFootprint: z.string().trim().max(150).default(""),
    }),
  )
  .handler(async ({ data, context }) => {
    const own = ownDomain(context.project);
    const queries = guestPostQueries(
      data.topics,
      data.footprints.filter(isFootprintId),
      data.customFootprint,
    );
    if (queries.length === 0)
      return { found: 0, error: "Choose at least one search phrase." };
    const prospects = await keepUnsuppressed(
      context.projectId,
      await guestPostProspects(
        createDataforseoClient(context),
        queries,
        marketOf(context.project, data),
        own ? [own] : [],
        { endings: data.endings, maxAuthority: data.maxAuthority },
      ),
    );
    await OutreachRepository.addProspects(context.projectId, prospects);
    return { found: prospects.length };
  });

/** Every website ranking for up to 5 Google searches, as leads. */
export const findSearchProspects = createServerFn({ method: "POST" })
  .middleware(requireProjectSeoRoute)
  .validator(
    projectInput.extend({
      topics: z.array(z.string().trim().min(2).max(200)).min(1).max(5),
      ...marketInput,
      ...serpFiltersInput,
      depth: z.union([
        z.literal(10),
        z.literal(20),
        z.literal(50),
        z.literal(100),
      ]),
    }),
  )
  .handler(async ({ data, context }) => {
    const own = ownDomain(context.project);
    const prospects = await keepUnsuppressed(
      context.projectId,
      await searchProspects(
        createDataforseoClient(context),
        data.topics,
        marketOf(context.project, data),
        own ? [own] : [],
        {
          endings: data.endings,
          maxAuthority: data.maxAuthority,
          depth: data.depth,
        },
      ),
    );
    await OutreachRepository.addProspects(context.projectId, prospects);
    return { found: prospects.length };
  });

/** Publications in one country that covered 1–5 topics (free news search). */
export const findPrProspects = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectInput.extend({ topics: topicsInput, ...marketInput }))
  .handler(async ({ data, context }) => {
    const own = ownDomain(context.project);
    const prospects = await keepUnsuppressed(
      context.projectId,
      await prProspects(
        data.topics,
        marketOf(context.project, data),
        own ? [own] : [],
      ),
    );
    await OutreachRepository.addProspects(context.projectId, prospects);
    return { found: prospects.length };
  });
