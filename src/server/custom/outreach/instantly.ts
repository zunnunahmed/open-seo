import { z } from "zod";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";

/**
 * Instantly.ai API v2. Instantly sends the emails (sequences, sending
 * accounts, warm-up, unsubscribes); OpenSEO only adds verified leads to a
 * campaign the user built there. The key is the Worker secret
 * INSTANTLY_API_KEY and never reaches the browser.
 */
const BASE = "https://api.instantly.ai/api/v2";

export class InstantlyError extends Error {}

async function request(
  path: string,
  init: { method?: "GET" | "POST"; body?: string } = {},
): Promise<unknown> {
  const key = await getOptionalEnvValue("INSTANTLY_API_KEY");
  if (!key)
    throw new InstantlyError(
      "Set the Cloudflare Worker secret INSTANTLY_API_KEY to connect Instantly.ai.",
    );
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (response.ok) return response.json();
  const reason =
    response.status === 401
      ? "Instantly rejected the API key."
      : response.status === 402
        ? "Instantly needs an active paid plan for API access."
        : response.status === 429
          ? "Instantly rate limit reached; try again in a minute."
          : `Instantly request failed (HTTP ${response.status}).`;
  throw new InstantlyError(reason);
}

const campaignsSchema = z.object({
  items: z.array(
    z
      .object({
        id: z.string(),
        name: z.string(),
        status: z.number().nullish(),
      })
      .passthrough(),
  ),
});

const STATUS: Record<number, string> = {
  0: "Draft",
  1: "Active",
  2: "Paused",
  3: "Completed",
  4: "Running subsequences",
};

export async function listInstantlyCampaigns() {
  const body = campaignsSchema.parse(await request("/campaigns?limit=100"));
  return body.items.map((campaign) => ({
    id: campaign.id,
    name: campaign.name,
    status: STATUS[campaign.status ?? -1] ?? "Unavailable",
  }));
}

type InstantlyLead = {
  email: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  website?: string;
  job_title?: string;
  custom_variables: Record<string, string>;
};

const addResultSchema = z
  .object({
    leads_uploaded: z.number().nullish(),
    duplicated_leads: z.number().nullish(),
    skipped_count: z.number().nullish(),
    in_blocklist: z.number().nullish(),
    invalid_email_count: z.number().nullish(),
  })
  .passthrough();

/** Add up to 1,000 leads; leads already anywhere in the workspace are skipped. */
export async function addInstantlyLeads(
  campaignId: string,
  leads: InstantlyLead[],
) {
  const result = addResultSchema.parse(
    await request("/leads/add", {
      method: "POST",
      body: JSON.stringify({
        campaign_id: campaignId,
        leads,
        skip_if_in_workspace: true,
      }),
    }),
  );
  return {
    uploaded: result.leads_uploaded ?? 0,
    skipped:
      (result.duplicated_leads ?? 0) +
      (result.skipped_count ?? 0) +
      (result.in_blocklist ?? 0) +
      (result.invalid_email_count ?? 0),
  };
}
