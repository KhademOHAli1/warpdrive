import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, isNotNull, isNull, ne } from "drizzle-orm";
import type { Db } from "@/db/client";
import { agencyProjectSettings } from "@/features/agency-projects/schema/agencyProjectSettings";
import { agencyProjects } from "@/features/agency-projects/schema/agencyProjects";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { err, ok } from "@/types/result";
import { lockInternalProject, withInternalProjects } from "../access";
import { readProjectCoverAsset } from "../brand/cover";
import { type ProjectResult, projectItemKey } from "../contracts";
import { internalProjectIntakeRequests as requests } from "../intake/schema";
import {
  changeOwnPublishedIntakeRequest,
  insertProjectIntakeRequest,
  isUnresolved,
  ownPublishedIntakeRequests,
  statusAt,
} from "../intake/service";
import { internalProjectItems as items, internalProjectSettings as settings } from "../schema";
import { readProjectWorkflowStates } from "../settings/states";
import type {
  MyPublishedIntakeRequests,
  ProjectPublicationSettings,
  PublicProjectBoard,
  PublishedIntakeRequest,
  PublishedIntakeRequestKey,
  PublishedIntakeRequestSummary,
  SaveProjectPublication,
  SubmitPublishedIntake,
  UpdatePublishedIntake,
  WithdrawPublishedIntake,
} from "./contracts";
import { internalProjectPublications as publications } from "./schema";

const publicationFields = {
  // Drizzle uses the first nested column as the left-join existence marker.
  revision: publications.revision,
  anchor: publications.anchor,
  listEnabled: publications.listEnabled,
  boardEnabled: publications.boardEnabled,
  showWorkItems: publications.showWorkItems,
  showBranding: publications.showBranding,
  allowIntake: publications.allowIntake,
};
const publicationDefaults = {
  anchor: null,
  revision: 0,
  listEnabled: true,
  boardEnabled: true,
  showWorkItems: false,
  showBranding: false,
  allowIntake: false,
};
const publicItemsPerPage = 100;

async function readOwnerSettings(tx: Db, projectId: string): Promise<ProjectPublicationSettings> {
  const [row] = await tx
    .select({ publication: publicationFields, intakeEnabled: settings.intakeEnabled })
    .from(settings)
    .leftJoin(publications, eq(publications.projectId, settings.projectId))
    .where(eq(settings.projectId, projectId));
  return {
    ...(row?.publication ?? publicationDefaults),
    intakeEnabled: row?.intakeEnabled ?? false,
  };
}

export function readProjectPublicationSettings(
  db: Db,
  session: NativeSessionRef,
  projectId: string,
  signal: AbortSignal,
) {
  return withInternalProjects<ProjectPublicationSettings>(
    db,
    session,
    signal,
    async (tx, actor) => {
      const access = await lockInternalProject(tx, actor, projectId, "read");
      if (!access.ok) return access;
      if (!access.value.canManageSettings) return err("project_forbidden");
      return ok(await readOwnerSettings(tx, projectId));
    },
  );
}

export function saveProjectPublication(
  db: Db,
  session: NativeSessionRef,
  input: SaveProjectPublication,
  signal: AbortSignal,
) {
  return withInternalProjects<ProjectPublicationSettings>(
    db,
    session,
    signal,
    async (tx, actor) => {
      const { projectId, revision, published, ...options } = input;
      const access = await lockInternalProject(tx, actor, projectId, "write");
      if (!access.ok) return access;
      if (!access.value.canManageSettings || access.value.summary.archived)
        return err("project_forbidden");
      const before = await readOwnerSettings(tx, projectId);
      if (before.revision !== revision || revision === Number.MAX_SAFE_INTEGER)
        return err("project_conflict");
      if (
        published &&
        ((!options.listEnabled && !options.boardEnabled) ||
          (options.allowIntake && !before.intakeEnabled && !before.allowIntake))
      )
        return err("project_invalid");
      const anchor = published ? (before.anchor ?? randomUUID()) : null;
      const next = { ...options, anchor, revision: revision + 1 };
      await tx
        .insert(publications)
        .values({ projectId, ...next })
        .onConflictDoUpdate({ target: publications.projectId, set: next });
      return ok({ ...next, intakeEnabled: before.intakeEnabled });
    },
  );
}

async function findPublishedProject(tx: Db, anchor: string) {
  const [project] = await tx
    .select({
      projectId: agencyProjects.id,
      title: agencyProjects.title,
      lifecycle: agencyProjects.state,
      identifier: settings.identifier,
      intakeEnabled: settings.intakeEnabled,
      logo: settings.logo,
      cover: settings.cover,
      timeZone: settings.timeZone,
      listEnabled: publications.listEnabled,
      boardEnabled: publications.boardEnabled,
      showWorkItems: publications.showWorkItems,
      showBranding: publications.showBranding,
      allowIntake: publications.allowIntake,
    })
    .from(publications)
    .innerJoin(agencyProjects, eq(agencyProjects.id, publications.projectId))
    .innerJoin(settings, eq(settings.projectId, agencyProjects.id))
    .innerJoin(
      agencyProjectSettings,
      and(eq(agencyProjectSettings.id, true), eq(agencyProjectSettings.enabled, true)),
    )
    .where(
      and(
        eq(publications.anchor, anchor),
        eq(agencyProjects.kind, "internal"),
        ne(agencyProjects.state, "archived"),
      ),
    );
  return project;
}

function acceptsRequests(project: NonNullable<Awaited<ReturnType<typeof findPublishedProject>>>) {
  return (
    project.allowIntake &&
    project.intakeEnabled &&
    (project.lifecycle === "planned" ||
      project.lifecycle === "active" ||
      project.lifecycle === "on-hold")
  );
}

async function readVisibleItems(tx: Db, projectId: string, identifier: string, page: number) {
  const rows = await tx
    .select({ title: items.title, stateId: items.stateId, sequenceNumber: items.sequenceNumber })
    .from(items)
    .where(
      and(
        eq(items.projectId, projectId),
        isNull(items.archivedAt),
        isNotNull(items.stateId),
        isNotNull(items.sequenceNumber),
      ),
    )
    .orderBy(asc(items.sequenceNumber), asc(items.id))
    .limit(publicItemsPerPage + 1)
    .offset((page - 1) * publicItemsPerPage);
  return {
    items: rows
      .slice(0, publicItemsPerPage)
      .flatMap(({ title, stateId, sequenceNumber }) =>
        stateId === null || sequenceNumber === null
          ? []
          : [{ title, stateId, key: projectItemKey(identifier, sequenceNumber) }],
      ),
    nextPage: rows.length > publicItemsPerPage && page < 1000 ? page + 1 : null,
  };
}

const publicRead = { isolationLevel: "repeatable read", accessMode: "read only" } as const;

export function readPublishedProjectBoard(
  db: Db,
  anchor: string,
  page: number,
  signal: AbortSignal,
) {
  return db.transaction(async (tx): Promise<ProjectResult<PublicProjectBoard>> => {
    signal.throwIfAborted();
    const project = await findPublishedProject(tx, anchor);
    if (project === undefined) return err("project_unavailable");
    const {
      projectId,
      title,
      identifier,
      showWorkItems,
      showBranding,
      logo,
      cover,
      timeZone,
      listEnabled,
      boardEnabled,
    } = project;
    const states = showWorkItems
      ? (await readProjectWorkflowStates(tx, projectId)).map(({ id, name, color }) => ({
          id,
          name,
          color,
        }))
      : [];
    const visible = showWorkItems
      ? await readVisibleItems(tx, projectId, identifier, page)
      : { items: [], nextPage: null };
    signal.throwIfAborted();
    return ok({
      title,
      logo: showBranding ? logo : null,
      cover: showBranding ? cover : null,
      timeZone,
      listEnabled,
      boardEnabled,
      showWorkItems,
      showIntake: project.allowIntake,
      acceptsRequests: acceptsRequests(project),
      states,
      ...visible,
    });
  }, publicRead);
}

export function readPublishedProjectCover(
  db: Db,
  anchor: string,
  version: string,
  signal: AbortSignal,
) {
  return db.transaction(async (tx): Promise<ProjectResult<{ data: string }>> => {
    signal.throwIfAborted();
    const project = await findPublishedProject(tx, anchor);
    if (
      project === undefined ||
      !project.showBranding ||
      project.cover?.kind !== "image" ||
      project.cover.value !== version
    )
      return err("project_unavailable");
    const bytes = await readProjectCoverAsset(tx, project.projectId, version);
    signal.throwIfAborted();
    return bytes === null ? err("project_unavailable") : ok({ data: bytes.toString("base64") });
  }, publicRead);
}

type LockedPublishedIntake = {
  tx: Db;
  projectId: string;
  actorId: string;
  canWrite: boolean;
};

function withPublishedIntake<T>(
  db: Db,
  session: NativeSessionRef,
  anchor: string,
  signal: AbortSignal,
  mode: "read" | "write",
  operation: (access: LockedPublishedIntake) => Promise<ProjectResult<T>>,
) {
  return withInternalProjects<T>(db, session, signal, async (tx, actor) => {
    const [entry] = await tx
      .select({ projectId: publications.projectId })
      .from(publications)
      .where(eq(publications.anchor, anchor));
    if (entry === undefined) return err("project_unavailable");
    const [locked] = await tx
      .select({ id: agencyProjects.id })
      .from(agencyProjects)
      .where(and(eq(agencyProjects.id, entry.projectId), eq(agencyProjects.kind, "internal")))
      .for(mode === "write" ? "update" : "share");
    if (locked === undefined) return err("project_unavailable");
    // Re-read after taking the project lock, so concurrent unpublish, archive, and Intake disable apply.
    const project = await findPublishedProject(tx, anchor);
    if (project === undefined || project.projectId !== locked.id || !project.allowIntake)
      return err("project_unavailable");
    const canWrite = acceptsRequests(project);
    if (mode === "write" && !canWrite) return err("project_forbidden");
    return operation({ tx, projectId: locked.id, actorId: actor.id, canWrite });
  });
}

export function submitPublishedProjectIntake(
  db: Db,
  session: NativeSessionRef,
  { anchor, ...request }: SubmitPublishedIntake,
  signal: AbortSignal,
) {
  return withPublishedIntake(db, session, anchor, signal, "write", ({ tx, actorId, projectId }) =>
    insertProjectIntakeRequest(tx, actorId, { projectId, ...request }, true),
  );
}

const publishedRequestFields = {
  id: requests.id,
  title: requests.title,
  priority: requests.priority,
  status: requests.status,
  snoozedUntil: requests.snoozedUntil,
  createdAt: requests.createdAt,
  revision: requests.revision,
};
type RequestRow = Pick<typeof requests.$inferSelect, keyof typeof publishedRequestFields>;
const visitorRequestsPerPage = 30;

function toPublishedRequestSummary(
  row: RequestRow,
  writable: boolean,
  now: Date,
): PublishedIntakeRequestSummary {
  const status = statusAt(row.status, row.snoozedUntil, now);
  return {
    id: row.id,
    title: row.title,
    priority: row.priority,
    status,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    canEdit: writable && isUnresolved(status) && row.revision < Number.MAX_SAFE_INTEGER,
  };
}

export function readMyPublishedIntakeRequests(
  db: Db,
  session: NativeSessionRef,
  anchor: string,
  page: number,
  signal: AbortSignal,
) {
  return withPublishedIntake<MyPublishedIntakeRequests>(
    db,
    session,
    anchor,
    signal,
    "read",
    async ({ tx, projectId, actorId, canWrite }) => {
      const rows = await tx
        .select(publishedRequestFields)
        .from(requests)
        .where(ownPublishedIntakeRequests(projectId, actorId))
        .orderBy(desc(requests.createdAt), asc(requests.id))
        .offset((page - 1) * visitorRequestsPerPage)
        .limit(visitorRequestsPerPage + 1);
      const now = new Date();
      return ok({
        requests: rows
          .slice(0, visitorRequestsPerPage)
          .map((row) => toPublishedRequestSummary(row, canWrite, now)),
        nextPage: rows.length > visitorRequestsPerPage && page < 1000 ? page + 1 : null,
      });
    },
  );
}

export function readPublishedIntakeRequest(
  db: Db,
  session: NativeSessionRef,
  { anchor, requestId }: PublishedIntakeRequestKey,
  signal: AbortSignal,
) {
  return withPublishedIntake<PublishedIntakeRequest>(
    db,
    session,
    anchor,
    signal,
    "read",
    async ({ tx, projectId, actorId, canWrite }) => {
      const [row] = await tx
        .select({ ...publishedRequestFields, description: requests.description })
        .from(requests)
        .where(and(ownPublishedIntakeRequests(projectId, actorId), eq(requests.id, requestId)));
      return row === undefined
        ? err("project_unavailable")
        : ok({
            ...toPublishedRequestSummary(row, canWrite, new Date()),
            description: row.description,
          });
    },
  );
}

export function updatePublishedIntakeRequest(
  db: Db,
  session: NativeSessionRef,
  { anchor, requestId, revision, ...changes }: UpdatePublishedIntake,
  signal: AbortSignal,
) {
  return withPublishedIntake(db, session, anchor, signal, "write", ({ tx, projectId, actorId }) =>
    changeOwnPublishedIntakeRequest(tx, actorId, { projectId, requestId, revision }, changes),
  );
}

export function withdrawPublishedIntakeRequest(
  db: Db,
  session: NativeSessionRef,
  { anchor, requestId, revision }: WithdrawPublishedIntake,
  signal: AbortSignal,
) {
  return withPublishedIntake(db, session, anchor, signal, "write", ({ tx, projectId, actorId }) =>
    changeOwnPublishedIntakeRequest(tx, actorId, { projectId, requestId, revision }, null),
  );
}
