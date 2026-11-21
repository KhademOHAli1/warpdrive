import { and, asc, desc, eq, exists, gt, isNull, lte, or, type SQL, sql } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { users } from "@/db/schema/identity";
import { agencyProjectMembers } from "@/features/agency-projects/schema/agencyProjects";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { err, ok } from "@/types/result";
import {
  type InternalProjectAccess,
  lockInternalProject,
  personFields,
  withInternalProjects,
} from "../access";
import type { ProjectResult } from "../contracts";
import { internalProjectItems, internalProjectSettings } from "../schema";
import { createInternalProjectItemInTransaction } from "../service";
import { readProjectWorkflowStates } from "../settings/states";
import type {
  ProjectIntakeFilter,
  ProjectIntakeRequest,
  ProjectIntakeStatus,
  ProjectIntakeSummary,
  ProjectIntakeWorkItem,
  ProjectIntakeWorkspace,
} from "./contracts";
import type {
  CreateIntakeRequestInput,
  ReadIntakeWorkspaceInput,
  ReviewIntakeRequestInput,
  UpdateIntakeRequestInput,
  WithdrawIntakeRequestInput,
} from "./input";
import { internalProjectIntakeRequests as requests } from "./schema";

const queuePageSize = 50;
const summaryFields = {
  id: requests.id,
  title: requests.title,
  priority: requests.priority,
  status: requests.status,
  requester: personFields,
  revision: requests.revision,
  createdAt: requests.createdAt,
  reviewedAt: requests.reviewedAt,
  snoozedUntil: requests.snoozedUntil,
  workItemId: requests.workItemId,
};

async function intakeEnabled(db: Db, projectId: string) {
  const [settings] = await db
    .select({ enabled: internalProjectSettings.intakeEnabled })
    .from(internalProjectSettings)
    .where(eq(internalProjectSettings.projectId, projectId));
  return settings?.enabled === true;
}

function acceptsRequests({ lifecycle }: InternalProjectAccess) {
  return (
    lifecycle.state === "active" || lifecycle.state === "planned" || lifecycle.state === "on-hold"
  );
}

function visibleRequests(db: Db, access: InternalProjectAccess, actorId: string) {
  // Read-only project members are Plane's guest equivalent and can see their own intake.
  // Use the stable membership grant for read scope even in read-only project lifecycle states.
  const scope = and(eq(requests.projectId, access.summary.id), isNull(requests.withdrawnAt));
  if (access.canManageSettings) return scope;
  const editor = exists(
    db
      .select({ userId: agencyProjectMembers.userId })
      .from(agencyProjectMembers)
      .where(
        and(
          eq(agencyProjectMembers.projectId, access.summary.id),
          eq(agencyProjectMembers.userId, actorId),
          eq(agencyProjectMembers.projectEdit, true),
        ),
      ),
  );
  return and(scope, or(eq(requests.requesterId, actorId), editor));
}

function statusAt(status: ProjectIntakeStatus, until: Date | null, now: Date) {
  return status === "snoozed" && until !== null && until <= now ? "pending" : status;
}

function matchesFilter(filter: ProjectIntakeFilter, now: Date) {
  if (filter === "all") return undefined;
  if (filter === "pending")
    return or(
      eq(requests.status, "pending"),
      and(eq(requests.status, "snoozed"), lte(requests.snoozedUntil, now)),
    );
  if (filter === "snoozed")
    return and(eq(requests.status, "snoozed"), gt(requests.snoozedUntil, now));
  return eq(requests.status, filter);
}

type SummaryRow = Omit<ProjectIntakeSummary, "createdAt" | "reviewedAt" | "snoozedUntil"> & {
  createdAt: Date;
  reviewedAt: Date | null;
  snoozedUntil: Date | null;
};

function summarize(row: SummaryRow, now: Date): ProjectIntakeSummary {
  const status = statusAt(row.status, row.snoozedUntil, now);
  return {
    ...row,
    status,
    createdAt: row.createdAt.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    snoozedUntil: status === "snoozed" ? (row.snoozedUntil?.toISOString() ?? null) : null,
  };
}

function isUnresolved(status: ProjectIntakeStatus) {
  return status === "pending" || status === "snoozed";
}

async function readSelected(
  db: Db,
  scope: SQL | undefined,
  requestId: string,
  actorId: string,
  canSubmit: boolean,
  canReview: boolean,
  now: Date,
): Promise<ProjectIntakeRequest | null> {
  const [row] = await db
    .select({ ...summaryFields, description: requests.description })
    .from(requests)
    .innerJoin(users, eq(requests.requesterId, users.id))
    .where(and(scope, eq(requests.id, requestId)));
  if (row === undefined) return null;
  const { description, ...fields } = row;
  const summary = summarize(fields, now);
  return {
    ...summary,
    description,
    canEdit:
      canSubmit && isUnresolved(summary.status) && (canReview || row.requester.id === actorId),
  };
}

export function readProjectIntake(
  db: Db,
  who: NativeSessionRef,
  input: ReadIntakeWorkspaceInput,
  signal: AbortSignal,
) {
  return withInternalProjects<ProjectIntakeWorkspace>(db, who, signal, async (tx, actor) => {
    const { projectId, filter, page, requestId } = input;
    const access = await lockInternalProject(tx, actor, projectId, "read");
    if (!access.ok) return access;
    const enabled = await intakeEnabled(tx, projectId);
    const canManageSettings = access.value.canManageSettings;
    const canSubmit = enabled && acceptsRequests(access.value);
    const canReview = canSubmit && canManageSettings && access.value.canEdit;
    if (!enabled)
      return ok({
        enabled,
        canSubmit,
        canReview,
        canManageSettings,
        requests: [],
        selected: null,
        states: [],
        nextPage: null,
      });
    const now = new Date();
    const scope = visibleRequests(tx, access.value, actor.id);
    const rows = await tx
      .select(summaryFields)
      .from(requests)
      .innerJoin(users, eq(requests.requesterId, users.id))
      .where(and(scope, matchesFilter(filter, now)))
      .orderBy(desc(requests.createdAt), asc(requests.id))
      .limit(queuePageSize + 1)
      .offset((page - 1) * queuePageSize);
    const selectedId = requestId ?? rows[0]?.id;
    const selected =
      selectedId === undefined
        ? null
        : await readSelected(tx, scope, selectedId, actor.id, canSubmit, canReview, now);
    if (requestId !== undefined && selected === null) return err("project_unavailable");
    return ok({
      enabled,
      canSubmit,
      canReview,
      canManageSettings,
      requests: rows.slice(0, queuePageSize).map((row) => summarize(row, now)),
      selected,
      states: canReview ? await readProjectWorkflowStates(tx, projectId) : [],
      nextPage: rows.length > queuePageSize && page < 1_000 ? page + 1 : null,
    });
  });
}

type LockedIntake = { db: Db; access: InternalProjectAccess; actorId: string };
type Receipt = { id: string };

function guardIntake<T>(
  db: Db,
  who: NativeSessionRef,
  projectId: string,
  signal: AbortSignal,
  operation: (intake: LockedIntake) => Promise<ProjectResult<T>>,
) {
  return withInternalProjects<T>(db, who, signal, async (tx, actor) => {
    const access = await lockInternalProject(tx, actor, projectId, "write");
    if (!access.ok) return access;
    if (!acceptsRequests(access.value) || !(await intakeEnabled(tx, projectId)))
      return err("project_forbidden");
    return operation({ db: tx, access: access.value, actorId: actor.id });
  });
}

export function createProjectIntake(
  db: Db,
  who: NativeSessionRef,
  input: CreateIntakeRequestInput,
  signal: AbortSignal,
) {
  return guardIntake<Receipt>(db, who, input.projectId, signal, async ({ db: tx, actorId }) => {
    const { projectId, intentId, title, description, priority } = input;
    const [existing] = await tx
      .select()
      .from(requests)
      .where(
        and(
          eq(requests.projectId, projectId),
          eq(requests.requesterId, actorId),
          eq(requests.createIntentId, intentId),
        ),
      );
    if (existing !== undefined) {
      if (existing.withdrawnAt !== null) return err("project_conflict");
      const identical =
        existing.title === title &&
        existing.description === description &&
        existing.priority === priority;
      return existing.revision > 0 || identical ? ok({ id: existing.id }) : err("project_conflict");
    }
    const [created] = await tx
      .insert(requests)
      .values({
        projectId,
        requesterId: actorId,
        createIntentId: intentId,
        title,
        description,
        priority,
      })
      .returning({ id: requests.id });
    if (created === undefined)
      throw new AppError(ERROR_IDS.DB_INVARIANT, "Intake request was not created");
    return ok(created);
  });
}

type IntakeRow = typeof requests.$inferSelect;
type Versioned = WithdrawIntakeRequestInput;

function changeIntake(
  db: Db,
  who: NativeSessionRef,
  input: Versioned,
  signal: AbortSignal,
  ownerOnly: boolean,
  change: (intake: LockedIntake, row: IntakeRow, now: Date) => Promise<ProjectResult<Receipt>>,
) {
  return guardIntake<Receipt>(db, who, input.projectId, signal, async (intake) => {
    const scope = visibleRequests(intake.db, intake.access, intake.actorId);
    const [row] = await intake.db
      .select()
      .from(requests)
      .where(and(scope, eq(requests.id, input.requestId)));
    if (row === undefined) return err("project_unavailable");
    const canReview = intake.access.canManageSettings && intake.access.canEdit;
    if (!canReview && (ownerOnly || row.requesterId !== intake.actorId))
      return err("project_forbidden");
    const now = new Date();
    if (
      row.revision !== input.revision ||
      row.revision === Number.MAX_SAFE_INTEGER ||
      !isUnresolved(statusAt(row.status, row.snoozedUntil, now))
    )
      return err("project_conflict");
    return change(intake, row, now);
  });
}

type Update = Partial<
  Pick<
    typeof requests.$inferInsert,
    | "title"
    | "description"
    | "priority"
    | "status"
    | "workItemId"
    | "snoozedUntil"
    | "reviewedAt"
    | "reviewedBy"
    | "withdrawnAt"
  >
>;

async function updateIntake(db: Db, row: IntakeRow, fields: Update) {
  const [updated] = await db
    .update(requests)
    .set({ ...fields, revision: row.revision + 1 })
    .where(
      and(
        eq(requests.projectId, row.projectId),
        eq(requests.id, row.id),
        eq(requests.revision, row.revision),
      ),
    )
    .returning({ id: requests.id });
  // An acceptance may already have created a work item in this transaction.
  if (updated === undefined)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Intake request revision was not saved");
  return ok(updated);
}

export function updateProjectIntake(
  db: Db,
  who: NativeSessionRef,
  input: UpdateIntakeRequestInput,
  signal: AbortSignal,
) {
  return changeIntake(db, who, input, signal, false, ({ db: tx }, row) =>
    updateIntake(tx, row, {
      title: input.title,
      description: input.description,
      priority: input.priority,
    }),
  );
}

export function withdrawProjectIntake(
  db: Db,
  who: NativeSessionRef,
  input: WithdrawIntakeRequestInput,
  signal: AbortSignal,
) {
  return changeIntake(db, who, input, signal, false, ({ db: tx }, row, now) =>
    updateIntake(tx, row, { withdrawnAt: now }),
  );
}

async function decideIntake(
  intake: LockedIntake,
  row: IntakeRow,
  input: ReviewIntakeRequestInput,
  now: Date,
): Promise<ProjectResult<Update>> {
  const { db, access, actorId } = intake;
  switch (input.action) {
    case "accept": {
      const created = await createInternalProjectItemInTransaction(
        db,
        access,
        actorId,
        {
          id: row.id,
          projectId: row.projectId,
          title: row.title,
          description: row.description,
          priority: row.priority,
          stateId: input.stateId,
        },
        { kind: "intake", createdBy: row.requesterId },
      );
      return created.ok ? ok({ status: "accepted", workItemId: created.value.itemId }) : created;
    }
    case "duplicate": {
      const [item] = await db
        .select({ id: internalProjectItems.id })
        .from(internalProjectItems)
        .where(
          and(
            eq(internalProjectItems.projectId, row.projectId),
            eq(internalProjectItems.id, input.workItemId),
            isNull(internalProjectItems.archivedAt),
          ),
        );
      return item === undefined
        ? err("project_invalid")
        : ok({ status: "duplicate", workItemId: item.id });
    }
    case "snooze": {
      const until = new Date(input.until);
      const maxSnoozeMs = 366 * 24 * 60 * 60 * 1000;
      return until > now && until.getTime() - now.getTime() <= maxSnoozeMs
        ? ok({ status: "snoozed", snoozedUntil: until })
        : err("project_invalid");
    }
    case "unsnooze":
      return row.status === "snoozed" ? ok({ status: "pending" }) : err("project_conflict");
    case "decline":
      return ok({ status: "declined" });
  }
}

export function reviewProjectIntake(
  db: Db,
  who: NativeSessionRef,
  input: ReviewIntakeRequestInput,
  signal: AbortSignal,
) {
  return changeIntake(db, who, input, signal, true, async (intake, row, now) => {
    const result = await decideIntake(intake, row, input, now);
    if (!result.ok) return result;
    return updateIntake(intake.db, row, {
      snoozedUntil: null,
      ...result.value,
      reviewedBy: intake.actorId,
      reviewedAt: now,
    });
  });
}

export function setProjectIntakeEnabled(
  db: Db,
  who: NativeSessionRef,
  { projectId, enabled, revision }: { projectId: string; enabled: boolean; revision: number },
  signal: AbortSignal,
) {
  return withInternalProjects<{ enabled: boolean; revision: number }>(
    db,
    who,
    signal,
    async (tx, actor) => {
      const access = await lockInternalProject(tx, actor, projectId, "write");
      if (!access.ok) return access;
      if (!access.value.canManageSettings || access.value.summary.archived)
        return err("project_forbidden");
      if (revision === Number.MAX_SAFE_INTEGER) return err("project_conflict");
      const [saved] = await tx
        .update(internalProjectSettings)
        .set({ intakeEnabled: enabled, revision: revision + 1 })
        .where(
          and(
            eq(internalProjectSettings.projectId, projectId),
            eq(internalProjectSettings.revision, revision),
          ),
        )
        .returning({
          enabled: internalProjectSettings.intakeEnabled,
          revision: internalProjectSettings.revision,
        });
      return saved === undefined ? err("project_conflict") : ok(saved);
    },
  );
}

export function findIntakeWorkItems(
  db: Db,
  who: NativeSessionRef,
  projectId: string,
  search: string,
  signal: AbortSignal,
) {
  return withInternalProjects<ProjectIntakeWorkItem[]>(db, who, signal, async (tx, actor) => {
    const access = await lockInternalProject(tx, actor, projectId, "read");
    if (!access.ok) return access;
    if (
      !access.value.canManageSettings ||
      !access.value.canEdit ||
      !(await intakeEnabled(tx, projectId))
    )
      return err("project_forbidden");
    const { id, title, sequenceNumber } = internalProjectItems;
    const prefix = access.value.summary.identifier;
    const items = await tx
      .select({ id, title, sequenceNumber })
      .from(internalProjectItems)
      .where(
        and(
          eq(internalProjectItems.projectId, projectId),
          isNull(internalProjectItems.archivedAt),
          or(
            sql`strpos(lower(${title}), lower(${search})) > 0`,
            sql`strpos(lower(${prefix} || '-' || ${sequenceNumber}::text), lower(${search})) > 0`,
          ),
        ),
      )
      .orderBy(desc(sequenceNumber), asc(id))
      .limit(30);
    return ok(
      items.map((item) => ({
        id: item.id,
        title: item.title,
        identifier: `${prefix}-${item.sequenceNumber}`,
      })),
    );
  });
}
