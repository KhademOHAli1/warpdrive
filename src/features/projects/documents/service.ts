import { and, asc, desc, eq, isNotNull, or, sql } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { users } from "@/db/schema/identity";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { err, ok } from "@/types/result";
import {
  type InternalProjectAccess,
  lockInternalProject,
  personFields,
  withInternalProjects,
} from "../access";
import type { ProjectResult } from "../contracts";
import {
  type CreateProjectDocumentInput,
  type ProjectDocumentDetail,
  type ProjectDocumentKey,
  type ProjectDocumentSummary,
  type ProjectDocumentsIndex,
  type ProjectDocumentVersion,
  projectDocumentBodyMaxLength,
  type ReadProjectDocumentVersionInput,
  type RestoreProjectDocumentVersionInput,
  type SaveProjectDocumentInput,
  type SetProjectDocumentLifecycleInput,
} from "./contracts";
import type {
  ProjectDocumentCollaboration,
  ProjectDocumentCollaborationInput,
} from "./live/contracts";
import { projectDocumentHtml } from "./live/html";
import { exchangeProjectDocumentPresence } from "./live/presence";
import { mergeProjectDocument } from "./live/state";
import {
  internalProjectDocuments as documents,
  internalProjectDocumentVersions as versions,
} from "./schema";

const summaryFields = {
  id: documents.id,
  title: documents.title,
  author: personFields,
  visibility: documents.visibility,
  locked: documents.locked,
  archivedAt: documents.archivedAt,
  updatedAt: documents.updatedAt,
  revision: documents.revision,
};

const versionSummaryFields = {
  revision: versions.revision,
  title: versions.title,
  recordedAt: versions.recordedAt,
};

function visibleDocument(projectId: string, actorId: string) {
  return and(
    eq(documents.projectId, projectId),
    or(eq(documents.visibility, "project"), eq(documents.authorUserId, actorId)),
  );
}

function documentSummary<T extends { archivedAt: Date | null; updatedAt: Date }>(row: T) {
  return {
    ...row,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function loadDocument(
  db: Db,
  actorId: string,
  { projectId, documentId }: ProjectDocumentKey,
) {
  const [row] = await db
    .select({
      ...summaryFields,
      bodyHtml: documents.bodyHtml,
      collaborationEpoch: documents.collaborationEpoch,
      collaborationActive: sql<boolean>`${isNotNull(documents.collaborationState)}`,
    })
    .from(documents)
    .innerJoin(users, eq(users.id, documents.authorUserId))
    .where(and(visibleDocument(projectId, actorId), eq(documents.id, documentId)));
  return row;
}

type DocumentRow = NonNullable<Awaited<ReturnType<typeof loadDocument>>>;

function publicDocument({
  id,
  title,
  author,
  visibility,
  locked,
  archivedAt,
  updatedAt,
  revision,
}: DocumentRow) {
  return documentSummary({
    id,
    title,
    author,
    visibility,
    locked,
    archivedAt,
    updatedAt,
    revision,
  });
}

function mayManageDocument(access: InternalProjectAccess, actorId: string, row: DocumentRow) {
  return access.canEdit && (row.author.id === actorId || access.summary.owner.id === actorId);
}

function mayEditDocument(access: InternalProjectAccess, row: DocumentRow) {
  return access.canEdit && !row.locked && row.archivedAt === null;
}

async function documentDetail(
  db: Db,
  access: InternalProjectAccess,
  actorId: string,
  row: DocumentRow,
): Promise<ProjectDocumentDetail> {
  const history = await db
    .select(versionSummaryFields)
    .from(versions)
    .where(eq(versions.documentId, row.id))
    .orderBy(desc(versions.revision));
  return {
    document: { ...publicDocument(row), bodyHtml: projectDocumentHtml(row.bodyHtml) },
    versions: history.map((entry) => ({ ...entry, recordedAt: entry.recordedAt.toISOString() })),
    canEdit: mayEditDocument(access, row),
    canManage: mayManageDocument(access, actorId, row),
  };
}

export function listProjectDocuments(
  db: Db,
  who: NativeSessionRef,
  projectId: string,
  signal: AbortSignal,
) {
  return withInternalProjects<ProjectDocumentsIndex>(db, who, signal, async (tx, actor) => {
    const access = await lockInternalProject(tx, actor, projectId, "read");
    if (!access.ok) return access;
    const rows = await tx
      .select(summaryFields)
      .from(documents)
      .innerJoin(users, eq(users.id, documents.authorUserId))
      .where(visibleDocument(projectId, actor.id))
      .orderBy(desc(documents.updatedAt), asc(documents.id));
    const summaries: ProjectDocumentSummary[] = rows.map(documentSummary);
    return ok({ documents: summaries, canCreate: access.value.canEdit });
  });
}

export function readProjectDocument(
  db: Db,
  who: NativeSessionRef,
  input: ProjectDocumentKey,
  signal: AbortSignal,
) {
  return withInternalProjects<ProjectDocumentDetail>(db, who, signal, async (tx, actor) => {
    const access = await lockInternalProject(tx, actor, input.projectId, "read");
    if (!access.ok) return access;
    const row = await loadDocument(tx, actor.id, input);
    return row === undefined
      ? err("project_unavailable")
      : ok(await documentDetail(tx, access.value, actor.id, row));
  });
}

async function loadVersion(db: Db, documentId: string, revision: number) {
  const [row] = await db
    .select({ ...versionSummaryFields, bodyHtml: versions.bodyHtml })
    .from(versions)
    .where(and(eq(versions.documentId, documentId), eq(versions.revision, revision)));
  return row;
}

export function readProjectDocumentVersion(
  db: Db,
  who: NativeSessionRef,
  input: ReadProjectDocumentVersionInput,
  signal: AbortSignal,
) {
  return withInternalProjects<ProjectDocumentVersion>(db, who, signal, async (tx, actor) => {
    const access = await lockInternalProject(tx, actor, input.projectId, "read");
    if (!access.ok) return access;
    if ((await loadDocument(tx, actor.id, input)) === undefined) return err("project_unavailable");
    const version = await loadVersion(tx, input.documentId, input.versionRevision);
    return version === undefined
      ? err("project_unavailable")
      : ok({
          ...version,
          recordedAt: version.recordedAt.toISOString(),
          bodyHtml: projectDocumentHtml(version.bodyHtml),
        });
  });
}

async function recordVersion(
  db: Db,
  editorUserId: string,
  documentId: string,
  revision: number,
  title: string,
  bodyHtml: string,
) {
  await db.insert(versions).values({ documentId, revision, title, bodyHtml, editorUserId });
}

async function replayDocumentCreate(db: Db, actorId: string, input: CreateProjectDocumentInput) {
  const [existing] = await db
    .select({ id: documents.id, visibility: documents.visibility })
    .from(documents)
    .where(
      and(
        eq(documents.projectId, input.projectId),
        eq(documents.authorUserId, actorId),
        eq(documents.createIntentId, input.id),
      ),
    );
  if (existing?.visibility !== input.visibility) return undefined;
  return (await loadVersion(db, existing.id, 0))?.title === input.title ? existing.id : undefined;
}

export function createProjectDocument(
  db: Db,
  who: NativeSessionRef,
  input: CreateProjectDocumentInput,
  signal: AbortSignal,
) {
  return withInternalProjects<ProjectDocumentDetail>(db, who, signal, async (tx, actor) => {
    const access = await lockInternalProject(tx, actor, input.projectId, "write");
    if (!access.ok) return access;
    if (!access.value.canEdit) return err("project_forbidden");
    const [inserted] = await tx
      .insert(documents)
      .values({
        projectId: input.projectId,
        authorUserId: actor.id,
        createIntentId: input.id,
        title: input.title,
        visibility: input.visibility,
      })
      .onConflictDoNothing({
        target: [documents.projectId, documents.authorUserId, documents.createIntentId],
      })
      .returning({ id: documents.id });
    const documentId = inserted?.id ?? (await replayDocumentCreate(tx, actor.id, input));
    if (documentId === undefined) return err("project_conflict");
    if (inserted !== undefined) await recordVersion(tx, actor.id, documentId, 0, input.title, "");
    return claimedDocumentDetail(tx, access.value, actor.id, {
      projectId: input.projectId,
      documentId,
    });
  });
}

async function claimedDocumentDetail(
  db: Db,
  access: InternalProjectAccess,
  actorId: string,
  input: ProjectDocumentKey,
) {
  const row = await loadDocument(db, actorId, input);
  if (row === undefined)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Project document was not visible after a write");
  return ok(await documentDetail(db, access, actorId, row));
}

type DocumentChange = Partial<
  Pick<
    typeof documents.$inferInsert,
    "title" | "bodyHtml" | "locked" | "archivedAt" | "collaborationState" | "collaborationEpoch"
  >
>;

async function updateDocument(
  db: Db,
  input: ProjectDocumentKey & { revision: number },
  change: DocumentChange,
) {
  const [updated] = await db
    .update(documents)
    .set({ ...change, revision: input.revision + 1, updatedAt: sql`clock_timestamp()` })
    .where(
      and(
        eq(documents.projectId, input.projectId),
        eq(documents.id, input.documentId),
        eq(documents.revision, input.revision),
      ),
    )
    .returning({ id: documents.id });
  return updated !== undefined;
}

function changeDocument(
  db: Db,
  who: NativeSessionRef,
  input: ProjectDocumentKey & { revision: number },
  capability: "edit" | "manage",
  signal: AbortSignal,
  change: (tx: Db, actorId: string, row: DocumentRow) => Promise<ProjectResult<void>>,
) {
  return withInternalProjects<ProjectDocumentDetail>(db, who, signal, async (tx, actor) => {
    const access = await lockInternalProject(tx, actor, input.projectId, "write");
    if (!access.ok) return access;
    const row = await loadDocument(tx, actor.id, input);
    if (row === undefined) return err("project_unavailable");
    const allowed =
      capability === "edit"
        ? mayEditDocument(access.value, row)
        : mayManageDocument(access.value, actor.id, row);
    if (!allowed) return err("project_forbidden");
    if (row.revision !== input.revision || row.revision === Number.MAX_SAFE_INTEGER)
      return err("project_conflict");
    const result = await change(tx, actor.id, row);
    return result.ok ? claimedDocumentDetail(tx, access.value, actor.id, input) : result;
  });
}

async function writeContent(
  db: Db,
  editorUserId: string,
  row: DocumentRow,
  input: SaveProjectDocumentInput,
  restore = false,
) {
  if (
    input.bodyHtml !== undefined &&
    Buffer.byteLength(input.bodyHtml) > projectDocumentBodyMaxLength
  )
    return err("project_invalid" as const);
  const bodyHtml =
    input.bodyHtml === undefined ? row.bodyHtml : projectDocumentHtml(input.bodyHtml);
  if (Buffer.byteLength(bodyHtml) > projectDocumentBodyMaxLength)
    return err("project_invalid" as const);
  if (!restore && row.collaborationActive && row.bodyHtml !== bodyHtml)
    return err("project_conflict" as const);
  if (!restore && row.title === input.title && row.bodyHtml === bodyHtml) {
    if (input.bodyHtml === undefined && (await loadVersion(db, row.id, row.revision)) === undefined)
      await recordVersion(db, editorUserId, row.id, row.revision, row.title, row.bodyHtml);
    return ok(undefined);
  }
  const reset = restore ? { collaborationState: null, collaborationEpoch: row.revision + 1 } : {};
  if (!(await updateDocument(db, input, { title: input.title, bodyHtml, ...reset })))
    return err("project_conflict" as const);
  await recordVersion(
    db,
    editorUserId,
    input.documentId,
    input.revision + 1,
    input.title,
    bodyHtml,
  );
  return ok(undefined);
}

export function saveProjectDocument(
  db: Db,
  who: NativeSessionRef,
  input: SaveProjectDocumentInput,
  signal: AbortSignal,
) {
  return changeDocument(db, who, input, "edit", signal, (tx, actorId, row) =>
    writeContent(tx, actorId, row, input),
  );
}

export function collaborateProjectDocument(
  db: Db,
  who: NativeSessionRef,
  input: ProjectDocumentCollaborationInput,
  signal: AbortSignal,
) {
  return withInternalProjects<ProjectDocumentCollaboration>(db, who, signal, async (tx, actor) => {
    if (input.update !== null && (input.epoch === null || input.stateVector === null))
      return err("project_invalid");
    const mode = input.epoch === null || input.update !== null ? "write" : "read";
    const access = await lockInternalProject(tx, actor, input.projectId, mode);
    if (!access.ok) return access;
    const row = await loadDocument(tx, actor.id, input);
    if (row === undefined) return err("project_unavailable");
    const canEdit = mayEditDocument(access.value, row);
    const canManage = mayManageDocument(access.value, actor.id, row);
    const atCurrentEpoch = input.epoch === row.collaborationEpoch;
    if (input.update !== null && atCurrentEpoch && !canEdit) return err("project_forbidden");
    const response = {
      epoch: row.collaborationEpoch,
      document: publicDocument(row),
      canEdit,
      canManage,
    };
    const result = await exchangeDocumentState(tx, input, row, response);
    if (!result.ok) return result;
    const update = atCurrentEpoch ? (input.presence ?? null) : null;
    const peers = result.value.live
      ? await exchangeProjectDocumentPresence(tx, who, access.value, result.value, update)
      : [];
    return ok({ ...result.value, peers });
  });
}

async function exchangeDocumentState(
  db: Db,
  input: ProjectDocumentCollaborationInput,
  row: DocumentRow,
  response: Pick<ProjectDocumentCollaboration, "epoch" | "document" | "canEdit" | "canManage">,
): Promise<ProjectResult<Omit<ProjectDocumentCollaboration, "peers">>> {
  // Only a current editor initializes the shared copy. Other readers pick it up
  // on their next exchange, when it is available.
  if (!row.collaborationActive && (!response.canEdit || input.epoch !== null))
    return ok({
      ...response,
      live: false,
      update: null,
      previewHtml: projectDocumentHtml(row.bodyHtml),
    });
  if (
    row.collaborationActive &&
    input.epoch === row.collaborationEpoch &&
    input.revision === row.revision &&
    input.update === null &&
    input.stateVector !== null
  )
    return ok({ ...response, live: true, update: null, previewHtml: null });
  const synchronized = await synchronizeDocumentState(db, input, row);
  return synchronized.ok
    ? ok({ ...response, ...synchronized.value, live: true, previewHtml: null })
    : synchronized;
}

async function synchronizeDocumentState(
  db: Db,
  input: ProjectDocumentCollaborationInput,
  row: DocumentRow,
) {
  // The caller holds the project authority lock, covering ordinary saves,
  // lifecycle changes and membership writes as well as this shared state.
  const scope = and(eq(documents.projectId, input.projectId), eq(documents.id, input.documentId));
  const [stored] = await db
    .select({ state: documents.collaborationState })
    .from(documents)
    .where(scope);
  if (stored === undefined)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Live project page disappeared");
  const current = input.epoch === row.collaborationEpoch;
  const merged = mergeProjectDocument(stored.state, row.bodyHtml, {
    stateVector: current ? input.stateVector : null,
    update: current ? input.update : null,
  });
  if (merged === null) return err("project_invalid" as const);
  if (merged.initialState !== null) {
    await db.update(documents).set({ collaborationState: merged.initialState }).where(scope);
  }
  if (merged.change === null) return ok({ document: publicDocument(row), update: merged.update });
  if (row.revision === Number.MAX_SAFE_INTEGER) return err("project_conflict" as const);
  const [persisted] = await db
    .update(documents)
    .set({
      collaborationState: merged.change.state,
      bodyHtml: merged.change.bodyHtml,
      revision: row.revision + 1,
      updatedAt: sql`clock_timestamp()`,
    })
    .where(scope)
    .returning({ updatedAt: documents.updatedAt });
  if (persisted === undefined)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Live project page did not persist");
  return ok({
    document: publicDocument({
      ...row,
      revision: row.revision + 1,
      updatedAt: persisted.updatedAt,
    }),
    update: merged.update,
  });
}

export function setProjectDocumentLifecycle(
  db: Db,
  who: NativeSessionRef,
  input: SetProjectDocumentLifecycleInput,
  signal: AbortSignal,
) {
  return changeDocument(db, who, input, "manage", signal, async (tx, _actorId, row) => {
    const action = input.action;
    if (action === "archive" || action === "restore") {
      const archived = action === "archive";
      if (archived === (row.archivedAt !== null)) return ok(undefined);
      return (await updateDocument(tx, input, {
        archivedAt: archived ? new Date() : null,
        collaborationEpoch: row.revision + 1,
      }))
        ? ok(undefined)
        : err("project_conflict");
    }
    if (row.archivedAt !== null) return err("project_forbidden");
    const locked = action === "lock";
    if (locked === row.locked) return ok(undefined);
    return (await updateDocument(tx, input, { locked, collaborationEpoch: row.revision + 1 }))
      ? ok(undefined)
      : err("project_conflict");
  });
}

export function restoreProjectDocumentVersion(
  db: Db,
  who: NativeSessionRef,
  input: RestoreProjectDocumentVersionInput,
  signal: AbortSignal,
) {
  return changeDocument(db, who, input, "edit", signal, async (tx, actorId, row) => {
    const version = await loadVersion(tx, input.documentId, input.versionRevision);
    if (version === undefined) return err("project_unavailable");
    return writeContent(
      tx,
      actorId,
      row,
      {
        ...input,
        title: version.title,
        bodyHtml: version.bodyHtml,
      },
      true,
    );
  });
}
