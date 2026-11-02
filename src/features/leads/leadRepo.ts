import {
  and,
  arrayOverlaps,
  asc,
  desc,
  eq,
  getTableColumns,
  inArray,
  isNotNull,
  isNull,
  type SQL,
  sql,
} from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { users } from "@/db/schema/identity";
import { type Lead, leads } from "@/db/schema/leads";
import { type Organization, organizations } from "@/db/schema/organizations";
import { type Person, persons } from "@/db/schema/persons";
import { contactVisibilityClause } from "@/features/contacts/visibilitySql";
import { isCustomFieldSortKey } from "@/features/custom-fields/sortKey";
import { customFieldOrderBy, resolveCustomFieldSort } from "@/features/custom-fields/sortSql";
import { canSee } from "@/features/permissions/canSee";
import type { AuthUser } from "@/features/permissions/types";
import { isUuidParam } from "@/lib/isUuidParam";
import { assertNever } from "@/types/result";
import type { DealVisibilitySession } from "@/types/session";
import { compileLeadFilter, LEAD_FILTER_CONFIG } from "./leadFilter";
import {
  type LeadBuiltinSortField,
  type LeadListInput,
  type LeadListParsed,
  type LeadNextActivityBucket,
  leadListInput,
} from "./schemas";
import { leadVisibilityClause } from "./visibility";

type Db = NodePgDatabase<typeof schema>;

function linkedContactVisibility(session: DealVisibilitySession): { person: SQL; org: SQL } {
  return {
    person: contactVisibilityClause(session, {
      ownerId: sql`${persons.ownerId}`,
      visibilityLevel: sql`${persons.visibilityLevel}`,
      visibilityGroupId: sql`${persons.visibilityGroupId}`,
      visibleToUserIds: sql`${persons.visibleToUserIds}`,
    }),
    org: contactVisibilityClause(session, {
      ownerId: sql`${organizations.ownerId}`,
      visibilityLevel: sql`${organizations.visibilityLevel}`,
      visibilityGroupId: sql`${organizations.visibilityGroupId}`,
      visibleToUserIds: sql`${organizations.visibleToUserIds}`,
    }),
  };
}

// Shared row projection so the paged list and the full export stay in lockstep.
const leadRowSelection = {
  id: leads.id,
  title: leads.title,
  value: leads.value,
  currency: leads.currency,
  labels: leads.labels,
  sourceOrigin: leads.sourceOrigin,
  personName: persons.name,
  orgName: organizations.name,
  ownerName: users.name,
  nextActivityAt: leads.nextActivityAt,
  createdAt: leads.createdAt,
  archivedAt: leads.archivedAt,
  updatedAt: leads.updatedAt,
  convertedDealId: leads.convertedDealId,
  customFields: sql<Record<string, unknown>>`${leads.customFields}`,
} as const;

export interface LeadRow {
  id: string;
  title: string;
  value: string | null;
  currency?: string;
  labels: string[];
  sourceOrigin: string;
  personName: string | null;
  orgName: string | null;
  ownerName: string | null;
  nextActivityAt: Date | null;
  createdAt: Date;
  archivedAt: Date | null;
  updatedAt: Date;
  convertedDealId: string | null;
  customFields: Record<string, unknown>;
}

// The full lead record plus resolved person/org/owner display names (detail page).
export type LeadDetail = Lead & {
  personName: string | null;
  orgName: string | null;
  ownerName: string | null;
};

// The fully-loaded linked person + organization records for the lead sidebar's Person/Organization
// blocks. Each linked contact has its own visibility rule, independent of the lead.
export interface LeadRelations {
  person: Person | null;
  org: Organization | null;
}

// Load the linked person + org for a lead. Soft-deleted contacts are filtered so the sidebar never
// renders a link to a detail page that 404s, matching summaryRepo's deletedAt filter for deals.
export async function getLeadRelations(
  db: Db,
  actor: AuthUser,
  lead: Pick<Lead, "personId" | "orgId">,
  signal: AbortSignal,
): Promise<LeadRelations> {
  signal.throwIfAborted();
  const [personRows, orgRows] = await Promise.all([
    lead.personId !== null
      ? db
          .select()
          .from(persons)
          .where(and(eq(persons.id, lead.personId), isNull(persons.deletedAt)))
      : Promise.resolve([]),
    lead.orgId !== null
      ? db
          .select()
          .from(organizations)
          .where(and(eq(organizations.id, lead.orgId), isNull(organizations.deletedAt)))
      : Promise.resolve([]),
  ]);
  signal.throwIfAborted();
  const person = personRows[0];
  const org = orgRows[0];
  return {
    person:
      person !== undefined &&
      canSee(actor, {
        kind: "person",
        ownerId: person.ownerId,
        visibilityLevel: person.visibilityLevel,
        visibilityGroupId: person.visibilityGroupId,
        visibleToUserIds: person.visibleToUserIds,
      })
        ? person
        : null,
    org:
      org !== undefined &&
      canSee(actor, {
        kind: "organization",
        ownerId: org.ownerId,
        visibilityLevel: org.visibilityLevel,
        visibilityGroupId: org.visibilityGroupId,
        visibleToUserIds: org.visibleToUserIds,
      })
        ? org
        : null,
  };
}

// A single visible lead with resolved names, or null when not visible (404-on-invisible:
// never leak existence to an actor who cannot see the lead).
export async function getLeadById(
  db: Db,
  session: DealVisibilitySession,
  id: string,
  signal: AbortSignal,
): Promise<LeadDetail | null> {
  signal.throwIfAborted();
  // A non-uuid id (a malformed [leadId] path param) can never match a row; short-circuit to the
  // not-found sentinel instead of letting Postgres reject the uuid cast and throw a 500.
  if (!isUuidParam(id)) return null;
  const contacts = linkedContactVisibility(session);
  const [row] = await db
    .select({
      ...getTableColumns(leads),
      personId: persons.id,
      orgId: organizations.id,
      personName: persons.name,
      orgName: organizations.name,
      ownerName: users.name,
    })
    .from(leads)
    .leftJoin(
      persons,
      and(eq(persons.id, leads.personId), isNull(persons.deletedAt), contacts.person),
    )
    .leftJoin(
      organizations,
      and(eq(organizations.id, leads.orgId), isNull(organizations.deletedAt), contacts.org),
    )
    .leftJoin(users, eq(users.id, leads.ownerId))
    .where(and(eq(leads.id, id), isNull(leads.deletedAt), leadVisibilityClause(session)));
  signal.throwIfAborted();
  return row ?? null;
}

// Map a sort field to its ORDER BY column. 'ownerName' sorts on the joined users.name;
// 'label' sorts on the leads.labels array (lexicographic, Postgres default).
function sortColumn(field: LeadBuiltinSortField): SQL {
  switch (field) {
    case "title":
      return sql`${leads.title}`;
    case "nextActivityAt":
      return sql`${leads.nextActivityAt}`;
    case "ownerName":
      return sql`${users.name}`;
    case "value":
      return sql`${leads.value}`;
    case "label":
      return sql`${leads.labels}`;
    case "sourceOrigin":
      return sql`${leads.sourceOrigin}`;
    case "createdAt":
      return sql`${leads.createdAt}`;
    default:
      return assertNever(field);
  }
}

// Server-side next-activity bucket predicate against next_activity_at.
function nextActivityClause(bucket: LeadNextActivityBucket): SQL {
  const col = leads.nextActivityAt;
  switch (bucket) {
    case "none":
      return sql`${col} IS NULL`;
    case "overdue":
      return sql`${col} < date_trunc('day', now())`;
    case "today":
      return sql`${col} >= date_trunc('day', now()) AND ${col} < date_trunc('day', now()) + interval '1 day'`;
    case "week":
      // From the start of today through the next 7 days.
      return sql`${col} >= date_trunc('day', now()) AND ${col} < date_trunc('day', now()) + interval '7 days'`;
    default:
      return assertNever(bucket);
  }
}

async function leadOrderBy(
  db: Db,
  sort: LeadListParsed["sort"],
  signal: AbortSignal,
): Promise<SQL> {
  if (isCustomFieldSortKey(sort.field)) {
    const def = await resolveCustomFieldSort(db, "lead", sort.field, signal);
    return customFieldOrderBy(leads.customFields, def, sort.dir);
  }
  const col = sortColumn(sort.field);
  if (sort.field === "value")
    return sql`${leads.currency} ASC, ${sort.dir === "asc" ? asc(col) : desc(col)}`;
  return sort.dir === "asc" ? asc(col) : desc(col);
}

function buildFilters(parsed: LeadListParsed): SQL[] {
  const conds: SQL[] = [];
  const { ownerIds, labelKeys, nextActivity, condition } = parsed.filters;
  if (ownerIds !== undefined && ownerIds.length > 0) conds.push(inArray(leads.ownerId, ownerIds));
  if (labelKeys !== undefined && labelKeys.length > 0)
    conds.push(arrayOverlaps(leads.labels, labelKeys));
  if (nextActivity !== undefined) conds.push(nextActivityClause(nextActivity));
  // Inline ad-hoc condition builder: re-validated + compiled to a bound, allow-listed SQL fragment
  // by the leadFilter module (the input was Zod-validated at the boundary; compile is defense in
  // depth). Null when the definition carries no conditions.
  if (condition !== undefined) {
    const frag = compileLeadFilter(condition, LEAD_FILTER_CONFIG);
    if (frag !== null) conds.push(frag);
  }
  return conds;
}

// Visible leads for the Leads Inbox. "inbox" = active (not archived); "archived" = archived only.
// Both exclude soft-deleted rows and apply the same visibility gate as deals. Sort and structured
// filters are applied server-side.
export async function listLeads(
  db: Db,
  session: DealVisibilitySession,
  input: LeadListInput,
  signal: AbortSignal,
): Promise<{ rows: LeadRow[]; total: number }> {
  signal.throwIfAborted();
  // Re-parse so callers may pass a partial object; zod fills sort/filters defaults. Idempotent when
  // the router already parsed via .input(leadListInput).
  const parsed = leadListInput.parse(input);
  const archiveGate =
    parsed.filter === "archived" ? isNotNull(leads.archivedAt) : isNull(leads.archivedAt);
  const where = and(
    isNull(leads.deletedAt),
    archiveGate,
    leadVisibilityClause(session),
    ...buildFilters(parsed),
  );

  const orderBy = await leadOrderBy(db, parsed.sort, signal);
  const contacts = linkedContactVisibility(session);

  const rows = await db
    .select(leadRowSelection)
    .from(leads)
    .leftJoin(
      persons,
      and(eq(persons.id, leads.personId), isNull(persons.deletedAt), contacts.person),
    )
    .leftJoin(
      organizations,
      and(eq(organizations.id, leads.orgId), isNull(organizations.deletedAt), contacts.org),
    )
    .leftJoin(users, eq(users.id, leads.ownerId))
    .where(where)
    // Stable tiebreak so equal sort keys keep a deterministic order. leads.id is the final,
    // guaranteed-unique key so offset pagination can never dup or skip on equal sort + createdAt.
    .orderBy(orderBy, desc(leads.createdAt), asc(leads.id))
    .offset(parsed.offset)
    .limit(parsed.limit);
  signal.throwIfAborted();

  const [countRow] = await db.select({ n: sql<number>`count(*)::int` }).from(leads).where(where);
  return { rows, total: countRow?.n ?? 0 };
}

// Full-result export: same visibility gate, filters, and sort as listLeads, but no offset/limit.
// Used by the /leads/export route to serialize every matching row server-side (not just the page).
export async function listLeadsForExport(
  db: Db,
  session: DealVisibilitySession,
  input: LeadListInput,
  signal: AbortSignal,
): Promise<LeadRow[]> {
  signal.throwIfAborted();
  const parsed = leadListInput.parse(input);
  const archiveGate =
    parsed.filter === "archived" ? isNotNull(leads.archivedAt) : isNull(leads.archivedAt);
  const where = and(
    isNull(leads.deletedAt),
    archiveGate,
    leadVisibilityClause(session),
    ...buildFilters(parsed),
  );
  const orderBy = await leadOrderBy(db, parsed.sort, signal);
  const contacts = linkedContactVisibility(session);

  const rows = await db
    .select(leadRowSelection)
    .from(leads)
    .leftJoin(
      persons,
      and(eq(persons.id, leads.personId), isNull(persons.deletedAt), contacts.person),
    )
    .leftJoin(
      organizations,
      and(eq(organizations.id, leads.orgId), isNull(organizations.deletedAt), contacts.org),
    )
    .leftJoin(users, eq(users.id, leads.ownerId))
    .where(where)
    .orderBy(orderBy, desc(leads.createdAt), asc(leads.id));
  signal.throwIfAborted();
  return rows;
}
