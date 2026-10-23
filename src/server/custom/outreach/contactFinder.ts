import { sort } from "remeda";
import { z } from "zod";
import { AppError } from "@/server/lib/errors";
import {
  getFromTreg,
  postToTreg,
} from "@/server/custom/providers/treg/dataforseoTransport";

/**
 * Find and verify up to two contacts at one prospect domain through treg.
 * One domain lookup answers most sites, so those go first; each bills only
 * when it returns emails:
 *   Tomba domain emails ($0.0089; treg allows only a few calls a minute)
 *   -> Hunter domain emails ($0.0245) when Tomba finds none or is busy
 *   -> per person, only when neither lists anyone: Dropleads people search
 *      (free) -> BlitzAPI, LinkedIn to email ($0.0005) -> TryKitt, name +
 *      domain ($0.005)
 *   -> MillionVerifier on every email ($0.0018; catch-all/unknown free).
 * Named people come before generic addresses such as info@. A person's email
 * on the site's own domain is preferred to one on another domain.
 */
type Verification = "valid" | "catch_all" | "unknown" | "invalid";

type FoundContact = {
  email: string;
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  linkedinUrl: string | null;
  foundVia: "blitz" | "trykitt" | "tomba" | "hunter";
  verification: Verification;
};

type ContactKind = "link" | "pr";

const TITLES: Record<ContactKind, string[]> = {
  link: [
    "editor",
    "content",
    "marketing",
    "founder",
    "owner",
    "seo",
    "communications",
  ],
  pr: ["editor", "journalist", "reporter", "writer", "news", "producer"],
};
const PEOPLE_PER_DOMAIN = 3;
const MAX_CONTACTS = 2;

// Approximate treg prices per billed result, for the cost shown to the user.
const PRICE = {
  blitz: 0.000495,
  trykitt: 0.005,
  tomba: 0.0089,
  hunter: 0.0245,
  verify: 0.00178,
};

const bareHost = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/^www\./, "");

/** The email's domain is the prospect's domain or one of its subdomains. */
function onDomain(email: string, domain: string): boolean {
  const host = bareHost(email.split("@")[1] ?? "");
  const site = bareHost(domain);
  return host === site || host.endsWith(`.${site}`);
}

const looksLikeEmail = (value: unknown): value is string =>
  typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

async function json(response: Response): Promise<unknown> {
  return response.json();
}

// Live Dropleads answers use camelCase; its docs show snake_case. Read both.
const personSchema = z
  .object({
    firstName: z.string().nullish(),
    first_name: z.string().nullish(),
    lastName: z.string().nullish(),
    last_name: z.string().nullish(),
    title: z.string().nullish(),
    linkedinUrl: z.string().nullish(),
    linkedin_url: z.string().nullish(),
  })
  .passthrough()
  .transform((person) => {
    const linkedin = person.linkedinUrl ?? person.linkedin_url;
    return {
      first_name: person.firstName ?? person.first_name,
      last_name: person.lastName ?? person.last_name,
      title: person.title,
      linkedin_url: linkedin?.replace(/^http:\/\//, "https://"),
    };
  });

async function searchPeople(domain: string, kind: ContactKind) {
  const body = await json(
    await postToTreg("dropleads.people.search", {
      filters: { companyDomains: [bareHost(domain)], jobTitles: TITLES[kind] },
      pagination: { page: 1, limit: PEOPLE_PER_DOMAIN },
    }),
  );
  const parsed = z
    .object({ data: z.object({ leads: z.array(personSchema) }).passthrough() })
    .passthrough()
    .safeParse(body);
  return parsed.success ? parsed.data.data.leads : [];
}

async function emailFromLinkedin(url: string): Promise<string | null> {
  const body = await json(
    await postToTreg("blitzapi.people.email.find", {
      person_linkedin_url: url,
    }),
  );
  const parsed = z
    .object({ found: z.boolean().optional(), email: z.unknown() })
    .passthrough()
    .safeParse(body);
  return parsed.success && looksLikeEmail(parsed.data.email)
    ? parsed.data.email
    : null;
}

async function emailFromName(
  fullName: string,
  domain: string,
): Promise<string | null> {
  const body = await json(
    await postToTreg("trykitt.people.email.find", {
      fullName,
      domain: bareHost(domain),
      realtime: true,
    }),
  );
  const parsed = z.object({ email: z.unknown() }).passthrough().safeParse(body);
  return parsed.success && looksLikeEmail(parsed.data.email)
    ? parsed.data.email
    : null;
}

const tombaEmailSchema = z
  .object({
    email: z.unknown(),
    first_name: z.string().nullish(),
    last_name: z.string().nullish(),
    position: z.string().nullish(),
    type: z.string().nullish(),
  })
  .passthrough();

async function domainEmails(domain: string) {
  const body = await json(
    await getFromTreg("tomba.companies.emails.list", {
      domain: bareHost(domain),
      limit: 10,
    }),
  );
  const parsed = z
    .object({
      data: z.object({ emails: z.array(tombaEmailSchema) }).passthrough(),
    })
    .passthrough()
    .safeParse(body);
  if (!parsed.success) return [];
  // People with a role first, then generic addresses such as editor@.
  return sort(
    parsed.data.data.emails.filter((entry) => looksLikeEmail(entry.email)),
    (a, b) => Number(a.type === "generic") - Number(b.type === "generic"),
  );
}

const hunterEmailSchema = z
  .object({
    value: z.unknown(),
    first_name: z.string().nullish(),
    last_name: z.string().nullish(),
    position: z.string().nullish(),
    linkedin: z.string().nullish(),
    type: z.string().nullish(),
  })
  .passthrough();

async function hunterDomainEmails(domain: string) {
  const body = await json(
    // Hunter bills per 10 emails returned, so 10 costs the same as 1.
    await getFromTreg("hunter.companies.emails", {
      domain: bareHost(domain),
      limit: 10,
    }),
  );
  const parsed = z
    .object({
      data: z.object({ emails: z.array(hunterEmailSchema) }).passthrough(),
    })
    .passthrough()
    .safeParse(body);
  if (!parsed.success) return [];
  return sort(
    parsed.data.data.emails.filter((entry) => looksLikeEmail(entry.value)),
    (a, b) => Number(a.type === "generic") - Number(b.type === "generic"),
  );
}

async function verify(email: string): Promise<Verification> {
  const body = await json(
    await getFromTreg("millionverifier.people.email.verify", {
      email,
      timeout: 10,
    }),
  );
  const parsed = z.object({ result: z.string() }).passthrough().safeParse(body);
  const result = parsed.success ? parsed.data.result : "unknown";
  if (result === "ok") return "valid";
  if (result === "catch_all") return "catch_all";
  if (result === "invalid" || result === "disposable") return "invalid";
  return "unknown";
}

/**
 * treg itself is unusable: not configured (no HTTP status), our token
 * refused, or no balance. Every other error is about one provider, whose
 * answer treg relays unchanged: "not found" as a 404, a used-up quota as a
 * 403, even a 401 when the provider rejects treg's own key for it. Those are
 * misses, so the next finder still runs.
 */
function isTregAccountError(error: unknown): error is AppError {
  if (!(error instanceof AppError) || error.code !== "TREG_REQUEST_FAILED")
    return false;
  const status = error.details?.providerStatus;
  if (!status || status === "402") return true;
  return (
    status === "401" &&
    /not signed in|token is invalid/i.test(error.details?.responseBody ?? "")
  );
}

/** What the user must fix when treg itself refused the work, else null. */
export function tregAccountProblem(error: unknown): string | null {
  if (!isTregAccountError(error)) return null;
  const status = error.details?.providerStatus;
  if (!status)
    return `treg is not set up on this deployment: ${error.message}.`;
  if (status === "402")
    return "Your treg balance is empty. Top up at treg.to, then try again.";
  let reason = "";
  try {
    const body = z
      .object({ error: z.string().optional(), message: z.string().optional() })
      .safeParse(JSON.parse(error.details?.responseBody ?? ""));
    reason = (body.data?.error ?? body.data?.message ?? "").slice(0, 200);
  } catch {
    // Not JSON: the status alone says enough.
  }
  return `treg refused the request (HTTP ${status}${reason ? `: ${reason}` : ""}). If your API key expired, create a new one at treg.to, update the TREG_API_TOKEN GitHub secret and deploy again.`;
}

/** A finder's failure (no match, rate limit, outage) is a miss, not fatal. */
async function attempt<T>(
  label: string,
  run: () => Promise<T>,
): Promise<T | null> {
  try {
    return await run();
  } catch (error) {
    if (isTregAccountError(error)) throw error;
    console.warn(`outreach.${label} failed`, error);
    return null;
  }
}

type Keep = (contact: Omit<FoundContact, "verification">) => boolean;

/** One person's email, the site's own address first; returns the cost. */
async function contactForPerson(
  person: z.infer<typeof personSchema>,
  domain: string,
  keep: Keep,
): Promise<number> {
  let costUsd = 0;
  const firstName = person.first_name?.trim() || null;
  const lastName = person.last_name?.trim() || null;
  const base = {
    firstName,
    lastName,
    title: person.title?.trim() || null,
    linkedinUrl: person.linkedin_url ?? null,
  };
  const fromLinkedin = person.linkedin_url
    ? await attempt("blitz", () => emailFromLinkedin(person.linkedin_url!))
    : null;
  if (fromLinkedin) costUsd += PRICE.blitz;
  if (
    fromLinkedin &&
    onDomain(fromLinkedin, domain) &&
    keep({ ...base, email: fromLinkedin, foundVia: "blitz" })
  )
    return costUsd;
  // The site's own address is likelier current, so try for one by name.
  const fullName = [firstName, lastName].filter(Boolean).join(" ");
  const fromName =
    fullName && lastName && !lastName.includes("*")
      ? await attempt("trykitt", () => emailFromName(fullName, domain))
      : null;
  if (fromName) {
    costUsd += PRICE.trykitt;
    if (keep({ ...base, email: fromName, foundVia: "trykitt" })) return costUsd;
  }
  // Otherwise an address on another domain (personal, or another company the
  // person works for) still reaches them.
  if (fromLinkedin) keep({ ...base, email: fromLinkedin, foundVia: "blitz" });
  return costUsd;
}

export async function findContactsForDomain(
  domain: string,
  kind: ContactKind,
  skip: Set<string>,
): Promise<{ contacts: FoundContact[]; costUsd: number }> {
  let costUsd = 0;
  const found: Array<Omit<FoundContact, "verification">> = [];
  const seen = new Set<string>();
  /** Keeps a usable email; false means try the next finder. */
  const keep: Keep = (contact) => {
    const email = contact.email.trim().toLowerCase();
    if (seen.has(email) || skip.has(email)) return false;
    seen.add(email);
    found.push({ ...contact, email });
    return true;
  };

  const tomba = (await attempt("tomba", () => domainEmails(domain))) ?? [];
  if (tomba.length > 0) costUsd += PRICE.tomba;
  for (const entry of tomba) {
    if (found.length >= MAX_CONTACTS) break;
    keep({
      email: String(entry.email),
      firstName: entry.first_name ?? null,
      lastName: entry.last_name ?? null,
      title: entry.position ?? null,
      linkedinUrl: null,
      foundVia: "tomba",
    });
  }

  if (found.length < MAX_CONTACTS) {
    const hunter =
      (await attempt("hunter", () => hunterDomainEmails(domain))) ?? [];
    if (hunter.length > 0) costUsd += PRICE.hunter;
    for (const entry of hunter) {
      if (found.length >= MAX_CONTACTS) break;
      keep({
        email: String(entry.value),
        firstName: entry.first_name ?? null,
        lastName: entry.last_name ?? null,
        title: entry.position ?? null,
        linkedinUrl: entry.linkedin ?? null,
        foundVia: "hunter",
      });
    }
  }

  // No named person yet (none listed, or only addresses like hello@): look
  // people up one by one, keeping one general address as a fallback.
  const named = found.some((contact) => contact.firstName);
  if (!named) found.splice(1);
  const people = named
    ? []
    : ((await attempt("dropleads", () => searchPeople(domain, kind))) ?? []);
  for (const person of people) {
    if (found.length >= MAX_CONTACTS) break;
    costUsd += await contactForPerson(person, domain, keep);
  }

  const contacts: FoundContact[] = [];
  for (const contact of found) {
    const verification =
      (await attempt("verify", () => verify(contact.email))) ?? "unknown";
    if (verification === "valid" || verification === "invalid")
      costUsd += PRICE.verify;
    contacts.push({ ...contact, verification });
  }
  return { contacts, costUsd };
}
