import { and, desc, eq, getTableColumns, inArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import type { EquipmentAuditEvent, EquipmentAuditEvidence } from "./contracts";
import {
  assetAuditAssignments as assignments,
  assetAudits as audits,
  assetAuditEvents as events,
  assetAuditEvidence as evidence,
  assetAuditRows as findings,
  assetAuditReceipts as receipts,
} from "./schema";
import type { AuditEvidenceHref, AuditFinding, AuditRecord } from "./state";
import type { AuditChange } from "./transitions";

export type AuditHeader = typeof audits.$inferSelect;
type Access = {
  actorId: string;
  managerSiteIds: readonly string[];
  assignedSiteIds: readonly string[];
};
type StoredReceipt = typeof receipts.$inferInsert;
export type StoredAuditPhoto = Pick<
  typeof evidence.$inferInsert,
  "sizeBytes" | "contentType" | "sha256" | "objectKey"
>;
type AuditAssignment = { id: string; userId: string | null; name: string };
type EvidenceWithoutHref = Omit<EquipmentAuditEvidence, "href">;

function invariant(message: string): never {
  throw new AppError(ERROR_IDS.DB_INVARIANT, message);
}

export async function findAuditSite(tx: Db, auditId: string) {
  const [row] = await tx
    .select({ siteId: audits.siteId })
    .from(audits)
    .where(eq(audits.id, auditId));
  return row?.siteId;
}

/** The caller holds the authority and directory fences. Never lock an unauthorized audit. */
export async function lockAuditHeader(
  tx: Db,
  siteId: string,
  auditId: string,
  mode: "read" | "write",
) {
  const [row] = await tx
    .select()
    .from(audits)
    .where(and(eq(audits.siteId, siteId), eq(audits.id, auditId)))
    .for(mode === "read" ? "share" : "update");
  return row;
}

const reportHeaderAlias = "audit_report_header";
const reportHeader = alias(audits, reportHeaderAlias);
const headerRef = sql.identifier(reportHeaderAlias);
const emptyEvents = sql<EquipmentAuditEvent[]>`'[]'::jsonb`;
const emptyEvidence = sql<EvidenceWithoutHref[]>`'[]'::jsonb`;

// Qualify both sides explicitly: Drizzle strips table prefixes from interpolated
// columns inside a SELECT expression when the outer query has no joins.
function reportFields(includeDetails: boolean) {
  return {
    ...getTableColumns(reportHeader),
    assignees: sql<AuditAssignment[]>`(
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', report_member.participant_id, 'name', report_member.name, 'userId', report_member.user_id
      ) ORDER BY report_member.position), '[]'::jsonb)
      FROM ${assignments} AS report_member
      WHERE report_member.site_id = ${headerRef}.site_id AND report_member.audit_id = ${headerRef}.id
    )`,
    rows: sql<AuditFinding[]>`(
      SELECT COALESCE(jsonb_agg(report_finding.identity || jsonb_build_object(
        'id', report_finding.id, 'expected', report_finding.expected, 'counted', report_finding.counted,
        'opaqueKey', report_finding.opaque_key
      ) ORDER BY report_finding.position), '[]'::jsonb)
      FROM ${findings} AS report_finding
      WHERE report_finding.site_id = ${headerRef}.site_id AND report_finding.audit_id = ${headerRef}.id
    )`,
    activity: includeDetails
      ? sql<EquipmentAuditEvent[]>`(
      SELECT COALESCE(jsonb_agg(report_event.snapshot || jsonb_build_object(
        'id', report_event.id, 'rowId', report_event.row_id, 'at', report_event.at
      ) ORDER BY report_event.version DESC, report_event.ordinal DESC), '[]'::jsonb)
      FROM ${events} AS report_event
      WHERE report_event.site_id = ${headerRef}.site_id AND report_event.audit_id = ${headerRef}.id
    )`
      : emptyEvents,
    evidence: includeDetails
      ? sql<EvidenceWithoutHref[]>`(
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', report_photo.id, 'rowId', report_photo.row_id, 'actor', report_photo.actor,
        'name', report_photo.name, 'source', report_photo.source, 'at', report_photo.at
      ) ORDER BY report_photo.at DESC, report_photo.id), '[]'::jsonb)
      FROM ${evidence} AS report_photo
      WHERE report_photo.site_id = ${headerRef}.site_id AND report_photo.audit_id = ${headerRef}.id
    )`
      : emptyEvidence,
  };
}

type ReportRow = AuditHeader & {
  assignees: AuditAssignment[];
  rows: AuditFinding[];
  activity: EquipmentAuditEvent[];
  evidence: EvidenceWithoutHref[];
};

function auditReport(row: ReportRow, hrefFor: AuditEvidenceHref): AuditRecord {
  const {
    assignees,
    activity,
    evidence: photos,
    createdAt,
    dueAt,
    startedAt,
    completedAt,
    reviewedAt,
    ...data
  } = row;
  return {
    ...data,
    createdAt: createdAt.toISOString(),
    dueAt: dueAt?.toISOString() ?? null,
    startedAt: startedAt?.toISOString() ?? null,
    completedAt: completedAt?.toISOString() ?? null,
    reviewedAt: reviewedAt?.toISOString() ?? null,
    assignees: assignees.map(({ id, name }) => ({ id, name })),
    assignedUserIds: assignees.flatMap(({ userId }) => (userId === null ? [] : [userId])),
    activity: activity.map((event) => ({ ...event, at: new Date(event.at).toISOString() })),
    evidence: photos.map((photo) => ({
      ...photo,
      at: new Date(photo.at).toISOString(),
      href: hrefFor(row.id, photo.id),
    })),
  };
}

export async function readAuditRecord(tx: Db, header: AuditHeader, hrefFor: AuditEvidenceHref) {
  const [row] = await tx
    .select(reportFields(true))
    .from(reportHeader)
    .where(and(eq(reportHeader.siteId, header.siteId), eq(reportHeader.id, header.id)));
  if (row?.version !== header.version)
    invariant("An equipment audit changed while its header was locked");
  return auditReport(row, hrefFor);
}

/** One statement keeps each visible header, findings and roster in the same snapshot. */
export async function readAuditRecords(tx: Db, access: Access, hrefFor: AuditEvidenceHref) {
  const { actorId, managerSiteIds, assignedSiteIds } = access;
  if (managerSiteIds.length + assignedSiteIds.length === 0) return [];
  const permittedAssignment = sql`EXISTS (
    SELECT 1 FROM ${assignments} AS assigned
    WHERE assigned.site_id = ${headerRef}.site_id AND assigned.audit_id = ${headerRef}.id
      AND assigned.user_id = ${actorId}
  )`;
  const rows = await tx
    .select(reportFields(false))
    .from(reportHeader)
    .where(
      or(
        inArray(reportHeader.siteId, managerSiteIds),
        and(inArray(reportHeader.siteId, assignedSiteIds), permittedAssignment),
      ),
    )
    .orderBy(desc(reportHeader.createdAt), desc(reportHeader.id));
  return rows.map((row) => auditReport(row, hrefFor));
}

export async function lockAuditRequest(tx: Db, actorId: string, requestId: string) {
  await tx.execute(sql`
    SELECT pg_advisory_xact_lock(hashtext('warpdrive-asset-audit-request'), hashtext(${`${actorId}:${requestId}`}))
  `);
}

export async function readAuditReceipt(tx: Db, actorId: string, requestId: string) {
  const [row] = await tx
    .select()
    .from(receipts)
    .where(and(eq(receipts.actorId, actorId), eq(receipts.requestId, requestId)));
  return row;
}

export async function readAuditEvidenceRecord(
  tx: Db,
  siteId: string,
  auditId: string,
  evidenceId: string,
) {
  const [row] = await tx
    .select()
    .from(evidence)
    .where(
      and(eq(evidence.siteId, siteId), eq(evidence.auditId, auditId), eq(evidence.id, evidenceId)),
    );
  return row;
}

function auditColumns(audit: AuditRecord): typeof audits.$inferInsert {
  const {
    id,
    siteId,
    version,
    title,
    status,
    archived,
    scope,
    createdAt,
    dueAt,
    startedAt,
    completedAt,
    reviewedAt,
  } = audit;
  return {
    id,
    siteId,
    version,
    title,
    status,
    archived,
    scope,
    createdAt: new Date(createdAt),
    dueAt: dueAt === null ? null : new Date(dueAt),
    startedAt: startedAt === null ? null : new Date(startedAt),
    completedAt: completedAt === null ? null : new Date(completedAt),
    reviewedAt: reviewedAt === null ? null : new Date(reviewedAt),
  };
}

async function saveHeader(tx: Db, previous: AuditRecord | undefined, audit: AuditRecord) {
  const values = auditColumns(audit);
  if (previous === undefined) {
    await tx.insert(audits).values(values);
    return;
  }
  const [changed] = await tx
    .update(audits)
    .set(values)
    .where(
      and(
        eq(audits.siteId, audit.siteId),
        eq(audits.id, audit.id),
        eq(audits.version, previous.version),
      ),
    )
    .returning({ id: audits.id });
  if (changed === undefined) invariant("An equipment audit changed while its header was locked");
}

async function saveAssignments(tx: Db, previous: AuditRecord | undefined, audit: AuditRecord) {
  if (previous?.assignees === audit.assignees) return;
  if (previous !== undefined)
    await tx
      .delete(assignments)
      .where(and(eq(assignments.siteId, audit.siteId), eq(assignments.auditId, audit.id)));
  if (audit.assignees.length === 0) return;
  const linked = audit.assignedUserIds ?? audit.assignees.map(({ id }) => id);
  await tx.insert(assignments).values(
    audit.assignees.map(({ id, name }, position) => ({
      siteId: audit.siteId,
      auditId: audit.id,
      participantId: id,
      userId: linked.includes(id) ? id : null,
      position,
      name,
    })),
  );
}

async function saveFindings(tx: Db, previous: AuditRecord | undefined, audit: AuditRecord) {
  const { siteId, id: auditId } = audit;
  const prior = new Map((previous?.rows ?? []).map((row) => [row.id, row]));
  const additions: (typeof findings.$inferInsert)[] = [];
  for (const [position, row] of audit.rows.entries()) {
    const existing = prior.get(row.id);
    if (existing === undefined) {
      const { id, expected, counted, opaqueKey, ...identity } = row;
      additions.push({ id, siteId, auditId, position, expected, counted, opaqueKey, identity });
    } else if (existing.counted !== row.counted) {
      const [updated] = await tx
        .update(findings)
        .set({ counted: row.counted })
        .where(
          and(eq(findings.siteId, siteId), eq(findings.auditId, auditId), eq(findings.id, row.id)),
        )
        .returning({ id: findings.id });
      if (updated === undefined) invariant("An equipment finding disappeared during a count");
    }
  }
  if (additions.length > 0) await tx.insert(findings).values(additions);
}

async function appendEvents(
  tx: Db,
  { audit, events: changes }: AuditChange,
  actorId: string | null,
) {
  await tx.insert(events).values(
    changes
      .slice()
      .reverse()
      .map(({ id, rowId, at, ...snapshot }, ordinal) => ({
        id,
        rowId,
        at: new Date(at),
        snapshot,
        ordinal,
        actorId,
        siteId: audit.siteId,
        auditId: audit.id,
        version: audit.version,
      })),
  );
}

async function appendEvidence(
  tx: Db,
  previous: AuditRecord | undefined,
  audit: AuditRecord,
  actorId: string | null,
  stored: StoredAuditPhoto | undefined,
) {
  const before = new Set(previous?.evidence.map(({ id }) => id));
  const additions = audit.evidence.filter(({ id }) => !before.has(id));
  if (additions.length === 0 && stored === undefined) return;
  const [photo] = additions;
  if (additions.length !== 1 || photo === undefined || stored === undefined)
    invariant("Equipment audit evidence was not matched to its stored photograph");
  const { id, rowId, actor, name, source, at } = photo;
  await tx.insert(evidence).values({
    ...stored,
    id,
    rowId,
    actor,
    name,
    source,
    at: new Date(at),
    siteId: audit.siteId,
    auditId: audit.id,
    actorId,
  });
}

/** Persist the validated change and its receipt in the caller's locked transaction. */
export async function persistAuditChange(
  tx: Db,
  previous: AuditRecord | undefined,
  change: AuditChange,
  receipt: Omit<StoredReceipt, "auditId">,
  photo?: StoredAuditPhoto,
) {
  const { audit, events: changes } = change;
  if (audit.siteId !== receipt.siteId || (previous !== undefined && previous.id !== audit.id))
    invariant("Equipment audit change and receipt do not share an identity");
  if (changes.length > 0) {
    await saveHeader(tx, previous, audit);
    await saveAssignments(tx, previous, audit);
    await saveFindings(tx, previous, audit);
    await appendEvents(tx, change, receipt.actorId ?? null);
    await appendEvidence(tx, previous, audit, receipt.actorId ?? null, photo);
  } else if (previous === undefined || photo !== undefined) {
    invariant("Equipment audit changes require activity");
  }
  await tx.insert(receipts).values({ ...receipt, auditId: audit.id });
}
