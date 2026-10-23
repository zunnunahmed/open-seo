import { sort } from "remeda";
import { z } from "zod";
import { AppError } from "@/server/lib/errors";
import {
  getFromTreg,
  postToTreg,
} from "@/server/custom/providers/treg/dataforseoTransport";

/**
 * Find and verify contacts at one prospect domain through treg, cheapest
 * first; each finder bills only when it returns an email:
 *   Dropleads people search (free) -> BlitzAPI, LinkedIn to email ($0.0005)
 *   -> TryKitt, name + domain ($0.005) for Blitz misses
 *   -> Tomba domain emails ($0.0089, 5 calls a day) when no person yields one
 *   -> MillionVerifier on every email ($0.0018; catch-all/unknown free).
 * Only emails on the prospect's own domain are kept, so a person's email at a
 * previous employer is never pitched.
 */
type Verification = "valid" | "catch_all" | "unknown" | "invalid";

type FoundContact = {
  email: string;
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  linkedinUrl: string | null;
  foundVia: "blitz" | "trykitt" | "tomba";
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
const MAX_CONTACTS = 3;

// Approximate treg prices per billed result, for the cost shown to the user.
const PRICE = {
  blitz: 0.000495,
  trykitt: 0.005,
  tomba: 0.0089,
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

const personSchema = z
  .object({
    first_name: z.string().nullish(),
    last_name: z.string().nullish(),
    title: z.string().nullish(),
    linkedin_url: z.string().nullish(),
  })
  .passthrough();

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

/** A finder's failure (rate limit, provider outage) is a miss, not fatal. */
async function attempt<T>(
  label: string,
  run: () => Promise<T>,
): Promise<T | null> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof AppError && error.code === "TREG_REQUEST_FAILED")
      throw error; // treg itself is misconfigured or out of balance
    console.warn(`outreach.${label} failed`, error);
    return null;
  }
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
  const keep = (contact: Omit<FoundContact, "verification">): boolean => {
    const email = contact.email.trim().toLowerCase();
    if (!onDomain(email, domain) || seen.has(email) || skip.has(email))
      return false;
    seen.add(email);
    found.push({ ...contact, email });
    return true;
  };

  // Dropleads is free and decides the rest: an error here (bad token, treg
  // down) surfaces instead of silently finding nobody.
  const people = await searchPeople(domain, kind);
  for (const person of people) {
    if (found.length >= MAX_CONTACTS) break;
    const firstName = person.first_name?.trim() || null;
    const lastName = person.last_name?.trim() || null;
    const base = {
      firstName,
      lastName,
      title: person.title?.trim() || null,
      linkedinUrl: person.linkedin_url ?? null,
    };
    let email = person.linkedin_url
      ? await attempt("blitz", () => emailFromLinkedin(person.linkedin_url!))
      : null;
    if (email) costUsd += PRICE.blitz;
    // An email at another company (a stale profile) is a miss for this site.
    if (email && keep({ ...base, email, foundVia: "blitz" })) continue;
    const fullName = [firstName, lastName].filter(Boolean).join(" ");
    if (!fullName || !lastName || lastName.includes("*")) continue;
    email = await attempt("trykitt", () => emailFromName(fullName, domain));
    if (email) {
      costUsd += PRICE.trykitt;
      keep({ ...base, email, foundVia: "trykitt" });
    }
  }

  if (found.length === 0) {
    const listed = (await attempt("tomba", () => domainEmails(domain))) ?? [];
    if (listed.length > 0) costUsd += PRICE.tomba;
    for (const entry of listed.slice(0, MAX_CONTACTS))
      keep({
        email: String(entry.email),
        firstName: entry.first_name ?? null,
        lastName: entry.last_name ?? null,
        title: entry.position ?? null,
        linkedinUrl: null,
        foundVia: "tomba",
      });
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
