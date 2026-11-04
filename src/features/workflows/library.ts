import { type SQL, sql } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import type { PermSetUser } from "@/features/permissions/effective";
import { hydrateActor } from "@/server/hydrateActor";
import { err, ok, type Result } from "@/types/result";
import { canWorkflow } from "./access";
import {
  libraryCursorFingerprint,
  readWorkflowLibraryCursor,
  readWorkflowOwnersCursor,
  type WorkflowLibraryCursor,
  writeWorkflowLibraryCursor,
  writeWorkflowOwnersCursor,
} from "./libraryCursor";
import {
  librarySubstringPattern,
  type NormalizedWorkflowLibraryInput,
  type NormalizedWorkflowOwnersInput,
  workflowLibraryInputSchema,
  workflowOwnersInputSchema,
} from "./libraryInput";

export type { WorkflowLibraryInput, WorkflowOwnersInput } from "./libraryInput";
export { workflowLibraryInputSchema, workflowOwnersInputSchema } from "./libraryInput";

type RunStatus = "queued" | "running" | "waiting" | "succeeded" | "failed" | "cancelled";
export interface WorkflowLibraryRow {
  id: string;
  name: string;
  revision: number;
  publishedNumber: number | null;
  active: boolean;
  archivedAt: Date | null;
  lifecycle: "draft" | "active" | "paused" | "archived";
  updatedAt: Date;
  owner: { id: string; name: string };
  latestLiveRun: { id: string; status: RunStatus; createdAt: Date } | null;
  capabilities: { archive: boolean; unarchive: boolean; duplicate: boolean };
}
export interface WorkflowLibraryPage {
  items: WorkflowLibraryRow[];
  nextCursor: string | null;
  scopeHasItems: boolean;
  capabilities: { create: boolean; filterOwners: boolean };
}
export interface WorkflowOwnersPage {
  items: { id: string; name: string }[];
  nextCursor: string | null;
}
type LibraryRecord = {
  scopeHasItems: boolean;
  id: string | null;
  name: string;
  revision: number;
  publishedNumber: number | null;
  active: boolean;
  archivedAt: Date | null;
  updatedAt: Date;
  ownerId: string;
  ownerName: string;
  latestId: string | null;
  latestStatus: RunStatus | null;
  latestCreatedAt: Date | null;
  cursorUpdatedAt: string;
};

function workflowScope(actor: PermSetUser, archive: "current" | "archived"): SQL {
  const visibility = actor.type === "admin" ? sql`true` : sql`w.owner_id = ${actor.id}::uuid`;
  const archival =
    archive === "archived" ? sql`w.archived_at IS NOT NULL` : sql`w.archived_at IS NULL`;
  return sql`(${visibility}) AND (${archival})`;
}

function pageFingerprint(actor: PermSetUser, input: NormalizedWorkflowLibraryInput): string {
  return libraryCursorFingerprint({
    actorId: actor.id,
    scope: actor.type === "admin" ? "admin" : "owner",
    query: input.query,
    archive: input.archive,
    status: input.status,
    ownerId: input.ownerId ?? null,
    health: input.health,
    sort: input.sort,
    limit: input.limit,
  });
}

function ownerFingerprint(actor: PermSetUser, input: NormalizedWorkflowOwnersInput): string {
  return libraryCursorFingerprint({
    actorId: actor.id,
    scope: "admin",
    query: input.query,
    archive: input.archive,
    limit: input.limit,
  });
}

// Server-only SQL builder, also reusable by bounded EXPLAIN qualification. Its caller
// must already have rehydrated and authorized the actor and parsed cursor/input.
export function buildWorkflowLibraryQuery(
  actor: PermSetUser,
  input: NormalizedWorkflowLibraryInput,
  cursor?: WorkflowLibraryCursor,
): SQL {
  const scope = workflowScope(actor, input.archive);
  const conditions: SQL[] = [scope];
  if (input.query !== "")
    conditions.push(sql`w.name ILIKE ${librarySubstringPattern(input.query)} ESCAPE E'\\\\'`);
  if (input.ownerId !== undefined) conditions.push(sql`w.owner_id = ${input.ownerId}::uuid`);
  if (input.status === "draft") conditions.push(sql`w.published_number IS NULL`);
  if (input.status === "active")
    conditions.push(sql`w.published_number IS NOT NULL AND w.active = true`);
  if (input.status === "paused")
    conditions.push(sql`w.published_number IS NOT NULL AND w.active = false`);
  if (input.health === "latest-live-failed") conditions.push(sql`latest.status = 'failed'`);
  if (cursor !== undefined) {
    const key = cursor.key;
    if (key.sort === "updated-desc")
      conditions.push(sql`(w.updated_at, w.id) < (${key.updatedAt}::timestamptz, ${key.id}::uuid)`);
    else if (key.sort === "name-asc")
      conditions.push(
        sql`(w.name COLLATE "C", w.id) > (${key.name}::text COLLATE "C", ${key.id}::uuid)`,
      );
    else
      conditions.push(
        sql`(w.name COLLATE "C", w.id) < (${key.name}::text COLLATE "C", ${key.id}::uuid)`,
      );
  }
  const order =
    input.sort === "updated-desc"
      ? sql`w.updated_at DESC, w.id DESC`
      : input.sort === "name-asc"
        ? sql`w.name COLLATE "C" ASC, w.id ASC`
        : sql`w.name COLLATE "C" DESC, w.id DESC`;
  // The existence fact and page share one statement snapshot. The LEFT lateral page
  // preserves the scoped fact even when no filtered row or continuation row remains.
  return sql`
    SELECT existence."scopeHasItems", page.*
    FROM (
      SELECT EXISTS(SELECT 1 FROM workflows w WHERE ${scope}) AS "scopeHasItems"
    ) existence
    LEFT JOIN LATERAL (
      SELECT w.id, w.name, w.revision, w.published_number AS "publishedNumber",
        w.active, w.archived_at AS "archivedAt", w.updated_at AS "updatedAt",
        u.id AS "ownerId", u.name AS "ownerName",
        latest.id AS "latestId", latest.status AS "latestStatus", latest.created_at AS "latestCreatedAt",
        to_char(w.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorUpdatedAt"
      FROM workflows w
      INNER JOIN users u ON u.id = w.owner_id
      LEFT JOIN LATERAL (
        SELECT r.id, r.status, r.created_at
        FROM workflow_runs r
        WHERE r.workflow_id = w.id AND r.mode = 'live'
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT 1
      ) latest ON true
      WHERE ${sql.join(conditions, sql` AND `)}
      ORDER BY ${order}
      LIMIT ${input.limit + 1}
    ) page ON true`;
}

function libraryRow(row: LibraryRecord, actor: PermSetUser): WorkflowLibraryRow {
  if (row.id === null) throw new AppError(ERROR_IDS.DB_INVARIANT, "Missing workflow library row");
  if (row.latestId !== null && (row.latestStatus === null || row.latestCreatedAt === null))
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Incomplete latest workflow run metadata");
  const archived = row.archivedAt !== null;
  const edit = canWorkflow(actor, "edit", row.ownerId);
  return {
    id: row.id,
    name: row.name,
    revision: row.revision,
    publishedNumber: row.publishedNumber,
    active: row.active,
    archivedAt: row.archivedAt,
    lifecycle: archived
      ? "archived"
      : row.publishedNumber === null
        ? "draft"
        : row.active
          ? "active"
          : "paused",
    updatedAt: row.updatedAt,
    owner: { id: row.ownerId, name: row.ownerName },
    latestLiveRun:
      row.latestId === null || row.latestStatus === null || row.latestCreatedAt === null
        ? null
        : { id: row.latestId, status: row.latestStatus, createdAt: row.latestCreatedAt },
    capabilities: {
      archive: !archived && edit,
      unarchive: archived && edit,
      duplicate: canWorkflow(actor, "create"),
    },
  };
}

function readPageCursor(
  input: NormalizedWorkflowLibraryInput,
  fingerprint: string,
): Result<WorkflowLibraryCursor | undefined, string> {
  if (input.cursor === undefined) return ok(undefined);
  const decoded = readWorkflowLibraryCursor(input.cursor, fingerprint);
  if (!decoded.ok) return decoded;
  return decoded.value.key.sort === input.sort ? decoded : err(ERROR_IDS.WORKFLOW_INVALID);
}

export async function listWorkflows(
  db: Db,
  actor: PermSetUser,
  signal: AbortSignal,
  raw?: unknown,
): Promise<Result<WorkflowLibraryPage, string>> {
  signal.throwIfAborted();
  const parsed = workflowLibraryInputSchema.safeParse(raw);
  if (!parsed.success) return err(ERROR_IDS.WORKFLOW_INVALID);
  const currentActor = await hydrateActor(db, actor.id, signal);
  if (currentActor === null || !canWorkflow(currentActor, "view"))
    return err(ERROR_IDS.WORKFLOW_DENIED);
  const input = parsed.data;
  if (currentActor.type !== "admin" && input.ownerId !== undefined) {
    if (input.ownerId !== currentActor.id) return err(ERROR_IDS.WORKFLOW_DENIED);
    // Own-only scope already applies this filter. Equivalent self filters share a cursor.
    input.ownerId = undefined;
  }
  const fingerprint = pageFingerprint(currentActor, input);
  const cursor = readPageCursor(input, fingerprint);
  if (!cursor.ok) return cursor;
  signal.throwIfAborted();
  const result = await db.execute<LibraryRecord>(
    buildWorkflowLibraryQuery(currentActor, input, cursor.value),
  );
  signal.throwIfAborted();
  const scope = result.rows[0];
  if (scope === undefined)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Workflow library query omitted its scope result");
  const rows = result.rows.filter((row) => row.id !== null);
  const shown = rows.slice(0, input.limit);
  let nextCursor: string | null = null;
  const last = shown.at(-1);
  if (rows.length > input.limit && last !== undefined && last.id !== null) {
    nextCursor = writeWorkflowLibraryCursor(
      fingerprint,
      input.sort === "updated-desc"
        ? { sort: input.sort, updatedAt: last.cursorUpdatedAt, id: last.id }
        : { sort: input.sort, name: last.name, id: last.id },
    );
  }
  return ok({
    items: shown.map((row) => libraryRow(row, currentActor)),
    nextCursor,
    scopeHasItems: scope.scopeHasItems,
    capabilities: {
      create: canWorkflow(currentActor, "create"),
      filterOwners: currentActor.type === "admin",
    },
  });
}

// The same SQL builder is used by the endpoint and query-plan qualification.
export function buildWorkflowOwnersQuery(
  actor: PermSetUser,
  input: NormalizedWorkflowOwnersInput,
  after?: string,
): SQL {
  const conditions = [workflowScope(actor, input.archive)];
  if (input.query !== "")
    conditions.push(sql`u.name ILIKE ${librarySubstringPattern(input.query)} ESCAPE E'\\\\'`);
  if (after !== undefined) conditions.push(sql`u.id > ${after}::uuid`);
  return sql`
    SELECT DISTINCT u.id, u.name
    FROM workflows w
    INNER JOIN users u ON u.id = w.owner_id
    WHERE ${sql.join(conditions, sql` AND `)}
    ORDER BY u.id ASC
    LIMIT ${input.limit + 1}`;
}

export async function listWorkflowOwners(
  db: Db,
  actor: PermSetUser,
  signal: AbortSignal,
  raw?: unknown,
): Promise<Result<WorkflowOwnersPage, string>> {
  signal.throwIfAborted();
  const parsed = workflowOwnersInputSchema.safeParse(raw);
  if (!parsed.success) return err(ERROR_IDS.WORKFLOW_INVALID);
  const currentActor = await hydrateActor(db, actor.id, signal);
  if (currentActor === null || !canWorkflow(currentActor, "view") || currentActor.type !== "admin")
    return err(ERROR_IDS.WORKFLOW_DENIED);
  const input = parsed.data;
  const fingerprint = ownerFingerprint(currentActor, input);
  let after: string | undefined;
  if (input.cursor !== undefined) {
    const decoded = readWorkflowOwnersCursor(input.cursor, fingerprint);
    if (!decoded.ok) return decoded;
    after = decoded.value.ownerId;
  }
  signal.throwIfAborted();
  const result = await db.execute<{ id: string; name: string }>(
    buildWorkflowOwnersQuery(currentActor, input, after),
  );
  signal.throwIfAborted();
  const items = result.rows.slice(0, input.limit).map(({ id, name }) => ({ id, name }));
  const last = items.at(-1);
  return ok({
    items,
    nextCursor:
      result.rows.length > input.limit && last !== undefined
        ? writeWorkflowOwnersCursor(fingerprint, last.id)
        : null,
  });
}
