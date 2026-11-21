import { and, asc, desc, eq, or, sql } from "drizzle-orm";
import { sanitize } from "isomorphic-dompurify";
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

// The document editor stores its own allowlist. In particular saving a document never embeds
// sources that can automatically make a browser request, even when the HTML was pasted.
function documentHtml(html: string): string {
  return sanitize(html, {
    ALLOWED_TAGS: [
      "p",
      "br",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "ul",
      "ol",
      "li",
      "blockquote",
      "pre",
      "code",
      "strong",
      "em",
      "b",
      "i",
      "s",
      "u",
      "hr",
      "a",
    ],
    ALLOWED_ATTR: ["href", "title", "start", "rel"],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#|\/(?![\\/]))/i,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  });
}

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
    .select({ ...summaryFields, bodyHtml: documents.bodyHtml })
    .from(documents)
    .innerJoin(users, eq(users.id, documents.authorUserId))
    .where(and(visibleDocument(projectId, actorId), eq(documents.id, documentId)));
  return row;
}

type DocumentRow = NonNullable<Awaited<ReturnType<typeof loadDocument>>>;

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
    document: documentSummary({ ...row, bodyHtml: documentHtml(row.bodyHtml) }),
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
          bodyHtml: documentHtml(version.bodyHtml),
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
  Pick<typeof documents.$inferInsert, "title" | "bodyHtml" | "locked" | "archivedAt">
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
) {
  if (Buffer.byteLength(input.bodyHtml) > projectDocumentBodyMaxLength)
    return err("project_invalid" as const);
  const bodyHtml = documentHtml(input.bodyHtml);
  if (Buffer.byteLength(bodyHtml) > projectDocumentBodyMaxLength)
    return err("project_invalid" as const);
  if (row.title === input.title && row.bodyHtml === bodyHtml) return ok(undefined);
  if (!(await updateDocument(db, input, { title: input.title, bodyHtml })))
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
      return (await updateDocument(tx, input, { archivedAt: archived ? new Date() : null }))
        ? ok(undefined)
        : err("project_conflict");
    }
    if (row.archivedAt !== null) return err("project_forbidden");
    const locked = action === "lock";
    if (locked === row.locked) return ok(undefined);
    return (await updateDocument(tx, input, { locked })) ? ok(undefined) : err("project_conflict");
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
    return writeContent(tx, actorId, row, {
      ...input,
      title: version.title,
      bodyHtml: version.bodyHtml,
    });
  });
}
