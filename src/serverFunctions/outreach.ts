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
  isUnpitchableDomain,
  linkGapProspects,
  prProspects,
} from "@/server/custom/outreach/prospectFinders";
import {
  findContactsForDomain,
  tregAccountProblem,
} from "@/server/custom/outreach/contactFinder";
import {
  addInstantlyLeads,
  InstantlyError,
  listInstantlyCampaigns,
} from "@/server/custom/outreach/instantly";

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

function ownDomain(project: { domain?: string | null }): string | null {
  return project.domain ? bareDomain(project.domain) : null;
}

/** Prospects and contacts for the Outreach page. */
export const getOutreach = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectInput)
  .handler(async ({ context }) => {
    const [prospects, contacts] = await Promise.all([
      OutreachRepository.listProspects(context.projectId),
      OutreachRepository.listContacts(context.projectId),
    ]);
    return { prospects, contacts };
  });

async function keepUnsuppressed<T extends { domain: string }>(
  projectId: string,
  prospects: T[],
): Promise<T[]> {
  const suppressed = await OutreachRepository.listSuppressions(projectId);
  return prospects.filter(
    (prospect) =>
      !suppressed.has(prospect.domain) && !isUnpitchableDomain(prospect.domain),
  );
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

/** Sites inviting guest posts on 1–5 topics (3 paid SERP lookups per topic). */
export const findGuestPostProspects = createServerFn({ method: "POST" })
  .middleware(requireProjectSeoRoute)
  .validator(projectInput.extend({ topics: topicsInput, ...marketInput }))
  .handler(async ({ data, context }) => {
    const own = ownDomain(context.project);
    const prospects = await keepUnsuppressed(
      context.projectId,
      await guestPostProspects(
        createDataforseoClient(context),
        data.topics,
        marketOf(context.project, data),
        own ? [own] : [],
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

export const importOutreachProspects = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectInput.extend({ domains: z.array(z.string()).max(500) }))
  .handler(async ({ data, context }) => {
    const domains = [
      ...new Set(data.domains.flatMap((value) => bareDomain(value) ?? [])),
    ];
    const prospects = await keepUnsuppressed(
      context.projectId,
      domains.map((domain) => ({ domain, source: "import" as const })),
    );
    await OutreachRepository.addProspects(context.projectId, prospects);
    return { found: prospects.length };
  });

/**
 * Add sites picked on the Backlinks page (already-fetched research, no new
 * paid request). The linking page becomes {{prospect_url}} in Instantly.
 */
export const addProspectsFromBacklinks = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    projectInput.extend({
      target: z.string().trim().min(1).max(253),
      items: z
        .array(
          z.object({
            domain: z.string().min(3).max(253),
            sourceUrl: z.string().url().max(2048).nullish(),
            authority: z.number().int().nullish(),
          }),
        )
        .min(1)
        .max(500),
    }),
  )
  .handler(async ({ data, context }) => {
    const own = ownDomain(context.project);
    const byDomain = new Map<
      string,
      {
        domain: string;
        source: "backlinks";
        sourceDetail: string;
        sourceUrl: string | null;
        authority: number | null;
      }
    >();
    for (const item of data.items) {
      const domain = bareDomain(item.domain);
      if (!domain || domain === own || byDomain.has(domain)) continue;
      byDomain.set(domain, {
        domain,
        source: "backlinks",
        sourceDetail: data.target,
        sourceUrl: item.sourceUrl ?? null,
        authority: item.authority ?? null,
      });
    }
    const prospects = await keepUnsuppressed(context.projectId, [
      ...byDomain.values(),
    ]);
    await OutreachRepository.addProspects(context.projectId, prospects);
    return { found: prospects.length };
  });

/**
 * Find and verify contacts for up to 3 prospects. Each prospect makes up to
 * ~11 paid-on-success treg calls, so a batch stays inside the Workers Free
 * subrequest cap; the page calls this repeatedly for larger selections.
 */
export const findOutreachContacts = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    projectInput.extend({ prospectIds: z.array(z.string()).min(1).max(3) }),
  )
  .handler(async ({ data, context }) => {
    const prospects = await OutreachRepository.getProspects(
      context.projectId,
      data.prospectIds,
    );
    const suppressed = await OutreachRepository.listSuppressions(
      context.projectId,
    );
    let found = 0;
    let costUsd = 0;
    for (const prospect of prospects) {
      let result: Awaited<ReturnType<typeof findContactsForDomain>>;
      try {
        result = await findContactsForDomain(
          prospect.domain,
          prospect.source === "pr" ? "pr" : "link",
          suppressed,
        );
      } catch (error) {
        const problem = tregAccountProblem(error);
        if (problem) return { ok: false as const, error: problem };
        throw error;
      }
      costUsd += result.costUsd;
      const now = new Date().toISOString();
      await OutreachRepository.addContacts(
        result.contacts.map((contact) => ({
          id: crypto.randomUUID(),
          projectId: context.projectId,
          prospectId: prospect.id,
          email: contact.email,
          firstName: contact.firstName,
          lastName: contact.lastName,
          title: contact.title,
          linkedinUrl: contact.linkedinUrl,
          foundVia: contact.foundVia,
          verification: contact.verification,
          verifiedAt: now,
          createdAt: now,
        })),
      );
      found += result.contacts.length;
      await OutreachRepository.setProspectStatus(
        context.projectId,
        [prospect.id],
        result.contacts.length > 0 ? "contacts_found" : "no_contacts",
        { contactsCheckedAt: now },
      );
    }
    return { ok: true as const, found, costUsd };
  });

export const getInstantlyCampaigns = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectInput)
  .handler(async () => {
    try {
      return { ok: true as const, campaigns: await listInstantlyCampaigns() };
    } catch (error) {
      if (error instanceof InstantlyError)
        return { ok: false as const, error: error.message };
      throw error;
    }
  });

/**
 * Push verified contacts to an Instantly campaign with personalisation
 * variables. Unverified, invalid, already-sent and do-not-contact emails are
 * never sent; catch-all addresses only when the user opts in.
 */
export const sendOutreachToInstantly = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    projectInput.extend({
      campaignId: z.string().min(1).max(100),
      contactIds: z.array(z.string()).min(1).max(500),
      includeCatchAll: z.boolean(),
    }),
  )
  .handler(async ({ data, context }) => {
    const [contacts, suppressed, prospects] = await Promise.all([
      OutreachRepository.getContacts(context.projectId, data.contactIds),
      OutreachRepository.listSuppressions(context.projectId),
      OutreachRepository.listProspects(context.projectId),
    ]);
    const prospectById = new Map(prospects.map((p) => [p.id, p]));
    const eligible = contacts.filter(
      (contact) =>
        !contact.sentAt &&
        !suppressed.has(contact.email) &&
        !suppressed.has(contact.email.split("@")[1] ?? "") &&
        (contact.verification === "valid" ||
          (data.includeCatchAll && contact.verification === "catch_all")),
    );
    if (eligible.length === 0)
      return {
        ok: false as const,
        error:
          "None of the selected contacts can be sent: they are unverified, invalid, already sent or on the do-not-contact list.",
      };
    try {
      const result = await addInstantlyLeads(
        data.campaignId,
        eligible.map((contact) => {
          const prospect = prospectById.get(contact.prospectId);
          return {
            email: contact.email,
            first_name: contact.firstName ?? undefined,
            last_name: contact.lastName ?? undefined,
            job_title: contact.title ?? undefined,
            company_name: prospect?.domain,
            website: prospect ? `https://${prospect.domain}` : undefined,
            custom_variables: {
              prospect_source: prospect?.source ?? "",
              prospect_detail: prospect?.sourceDetail ?? "",
              prospect_url: prospect?.sourceUrl ?? "",
              prospect_title: prospect?.sourceTitle ?? "",
            },
          };
        }),
      );
      await OutreachRepository.markContactsSent(
        context.projectId,
        eligible.map((contact) => contact.id),
        data.campaignId,
      );
      await OutreachRepository.setProspectStatus(
        context.projectId,
        [...new Set(eligible.map((contact) => contact.prospectId))],
        "sent",
      );
      return { ok: true as const, ...result, eligible: eligible.length };
    } catch (error) {
      if (error instanceof InstantlyError)
        return { ok: false as const, error: error.message };
      throw error;
    }
  });

export const updateOutreachStatus = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    projectInput.extend({
      prospectIds: z.array(z.string()).min(1).max(500),
      status: z.enum(["new", "replied", "won", "skipped"]),
    }),
  )
  .handler(async ({ data, context }) => {
    await OutreachRepository.setProspectStatus(
      context.projectId,
      data.prospectIds,
      data.status,
    );
    return { ok: true as const };
  });

/** Delete prospects and their contacts; they can be found again later. */
export const removeOutreachProspects = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    projectInput.extend({ prospectIds: z.array(z.string()).min(1).max(500) }),
  )
  .handler(async ({ data, context }) => {
    await OutreachRepository.deleteProspects(
      context.projectId,
      data.prospectIds,
    );
    return { ok: true as const };
  });

/** Add domains or emails to the do-not-contact list and drop those prospects. */
export const suppressOutreach = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    projectInput.extend({
      values: z.array(z.string().trim().min(3).max(320)).min(1).max(500),
      prospectIds: z.array(z.string()).max(500).default([]),
    }),
  )
  .handler(async ({ data, context }) => {
    await OutreachRepository.addSuppressions(
      context.projectId,
      data.values,
      "user",
    );
    await OutreachRepository.deleteProspects(
      context.projectId,
      data.prospectIds,
    );
    return { ok: true as const };
  });
