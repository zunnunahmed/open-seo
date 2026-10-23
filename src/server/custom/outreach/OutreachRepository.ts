import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  outreachContacts,
  outreachProspects,
  outreachSuppressions,
} from "@/db/schema";

type ProspectSource = (typeof outreachProspects.$inferInsert)["source"];
type ProspectStatus = NonNullable<
  (typeof outreachProspects.$inferInsert)["status"]
>;
type ContactInsert = typeof outreachContacts.$inferInsert;

export type NewProspect = {
  domain: string;
  source: ProspectSource;
  sourceDetail?: string | null;
  sourceUrl?: string | null;
  sourceTitle?: string | null;
  authority?: number | null;
};

// D1 binds at most 100 parameters per statement; prospects have 11 columns.
const PROSPECT_CHUNK = 8;
const CONTACT_CHUNK = 6;

function chunks<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/** Insert prospects; a domain already listed for the same source is kept. */
async function addProspects(projectId: string, prospects: NewProspect[]) {
  const now = new Date().toISOString();
  const rows = prospects.map((prospect) => ({
    id: crypto.randomUUID(),
    projectId,
    domain: prospect.domain,
    source: prospect.source,
    sourceDetail: prospect.sourceDetail ?? null,
    sourceUrl: prospect.sourceUrl ?? null,
    sourceTitle: prospect.sourceTitle ?? null,
    authority: prospect.authority ?? null,
    createdAt: now,
    updatedAt: now,
  }));
  for (const chunk of chunks(rows, PROSPECT_CHUNK))
    await db.insert(outreachProspects).values(chunk).onConflictDoNothing();
}

async function listProspects(projectId: string) {
  return db
    .select()
    .from(outreachProspects)
    .where(eq(outreachProspects.projectId, projectId))
    .orderBy(desc(outreachProspects.createdAt))
    .limit(2000);
}

async function getProspects(projectId: string, ids: string[]) {
  if (ids.length === 0) return [];
  return db
    .select()
    .from(outreachProspects)
    .where(
      and(
        eq(outreachProspects.projectId, projectId),
        inArray(outreachProspects.id, ids),
      ),
    );
}

async function setProspectStatus(
  projectId: string,
  ids: string[],
  status: ProspectStatus,
  extra: { contactsCheckedAt?: string } = {},
) {
  if (ids.length === 0) return;
  await db
    .update(outreachProspects)
    .set({ status, updatedAt: new Date().toISOString(), ...extra })
    .where(
      and(
        eq(outreachProspects.projectId, projectId),
        inArray(outreachProspects.id, ids),
      ),
    );
}

async function deleteProspects(projectId: string, ids: string[]) {
  if (ids.length === 0) return;
  await db
    .delete(outreachProspects)
    .where(
      and(
        eq(outreachProspects.projectId, projectId),
        inArray(outreachProspects.id, ids),
      ),
    );
}

async function listContacts(projectId: string) {
  return db
    .select()
    .from(outreachContacts)
    .where(eq(outreachContacts.projectId, projectId))
    .limit(5000);
}

async function getContacts(projectId: string, ids: string[]) {
  if (ids.length === 0) return [];
  return db
    .select()
    .from(outreachContacts)
    .where(
      and(
        eq(outreachContacts.projectId, projectId),
        inArray(outreachContacts.id, ids),
      ),
    );
}

/** Insert contacts; an email already known to the project is kept as is. */
async function addContacts(rows: ContactInsert[]) {
  for (const chunk of chunks(rows, CONTACT_CHUNK))
    await db.insert(outreachContacts).values(chunk).onConflictDoNothing();
}

async function markContactsSent(
  projectId: string,
  ids: string[],
  campaignId: string,
) {
  if (ids.length === 0) return;
  await db
    .update(outreachContacts)
    .set({ sentAt: new Date().toISOString(), instantlyCampaignId: campaignId })
    .where(
      and(
        eq(outreachContacts.projectId, projectId),
        inArray(outreachContacts.id, ids),
      ),
    );
}

async function listSuppressions(projectId: string): Promise<Set<string>> {
  const rows = await db
    .select({ value: outreachSuppressions.value })
    .from(outreachSuppressions)
    .where(eq(outreachSuppressions.projectId, projectId));
  return new Set(rows.map((row) => row.value));
}

async function addSuppressions(
  projectId: string,
  values: string[],
  reason: string,
) {
  const now = new Date().toISOString();
  const rows = [...new Set(values.map((value) => value.trim().toLowerCase()))]
    .filter(Boolean)
    .map((value) => ({ projectId, value, reason, createdAt: now }));
  for (const chunk of chunks(rows, 20))
    await db.insert(outreachSuppressions).values(chunk).onConflictDoNothing();
}

export const OutreachRepository = {
  addProspects,
  listProspects,
  getProspects,
  setProspectStatus,
  deleteProspects,
  listContacts,
  getContacts,
  addContacts,
  markContactsSent,
  listSuppressions,
  addSuppressions,
};
