import { and, eq, isNull } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import {
  type Activity,
  activities,
  activityGuests,
  activityParticipants,
  deals,
} from "@/db/schema";
import type { PreparedCustomFieldValidation } from "@/features/custom-fields/currentValidation";
import { listDefs } from "@/features/custom-fields/defsRepo";
import { buildCustomFieldsSchema } from "@/features/custom-fields/validate";
import { sanitizeAuthorHtml } from "@/features/email/sanitizeHtml";
import type { PermSetUser } from "@/features/permissions/effective";
import { assertReferenceVisible } from "@/features/permissions/referenceCheck";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { err, ok, type Result } from "@/types/result";
import { activityAccountPreferences } from "./accountTimeZone";
import { guardActivityMutation } from "./activityAccessGuard";
import { applyActivityReminders } from "./activityReminderWrite";
import { canonicalCreateDates, civilEndBeforeStart } from "./activityTemporalWrite";
import { activityTransaction } from "./activityTransaction";
import { reconcileReminderIntent } from "./calendarReminderIntent";
import { assertCalendarWritable } from "./calendars";
import { recomputeDealActivityDates } from "./nextActivity";
import { cancelActivityReminder, synchronizeActivityReminder } from "./reminderIntent";
import { scheduleReminder } from "./reminders";
import { type ActivityCreateInput, activityCreateInput } from "./schemas";

function calendarCreateOwnership(
  input: ReturnType<typeof activityCreateInput.parse>,
  timeZone: string,
) {
  return {
    reminderEngine:
      input.reminder === undefined &&
      (input.calendarId !== null || input.personalReminders !== undefined)
        ? ("intent" as const)
        : ("legacy" as const),
    eventTimeZone: input.eventTimeZone ?? (input.calendarId !== null ? timeZone : null),
    allDay: input.dueAt !== null && input.allDay,
  };
}

// Pipedrive parity: block linking a new activity to an archived deal. Extracted so
// createActivity stays under the cognitive-complexity budget. No-op when dealId is null.
async function assertDealNotArchived(
  tx: DbOrTx,
  dealId: string | null,
  signal: AbortSignal,
): Promise<Result<undefined, AppError>> {
  if (dealId === null) return ok(undefined);
  signal.throwIfAborted();
  const [dealRow] = await tx
    .select({ archivedAt: deals.archivedAt })
    .from(deals)
    .where(eq(deals.id, dealId));
  signal.throwIfAborted();
  if (dealRow?.archivedAt != null) {
    return err(
      new AppError(
        ERROR_IDS.DEAL_ARCHIVED_NO_ACTIVITY,
        "Cannot add an activity to an archived deal",
        { dealId },
      ),
    );
  }
  return ok(undefined);
}

// Sanitize the raw note HTML before it reaches Postgres. Extracted (alongside
// resolveDoneAt below) so createActivity stays under the cognitive-complexity budget.
function sanitizeNote(note: string | null): string | null {
  return note === null ? null : sanitizeAuthorHtml(note);
}

export interface CreateActivityOptions {
  doneAtOverride?: Date;
  scheduleReminder?: boolean;
  customFieldValidation?: PreparedCustomFieldValidation;
}

function resolveDoneAt(done: boolean, override: Date | undefined): Date | null {
  return done ? (override ?? new Date()) : null;
}

// Multi-day guard: a provided endAt must not precede the start (dueAt). Both are ISO strings
// at this point. No-op when either bound is absent (a dateless or open-ended activity).
function assertEndNotBeforeStart(
  dueAt: string | null,
  endAt: string | null,
): Result<undefined, AppError> {
  if (dueAt === null || endAt === null) return ok(undefined);
  if (new Date(endAt).getTime() < new Date(dueAt).getTime()) {
    return err(
      new AppError(ERROR_IDS.ACTIVITY_END_BEFORE_START, "activity end is before its start", {
        dueAt,
        endAt,
      }),
    );
  }
  return ok(undefined);
}

type RefKind = "deal" | "lead" | "person" | "organization" | "user";

// Collect every entity a create payload references, so createActivity can visibility-gate them
// in one loop. Extracted to keep createActivity under the cognitive-complexity budget.
function collectReferences(input: {
  dealId: string | null;
  leadId: string | null;
  personId: string | null;
  orgId: string | null;
  assigneeId?: string;
  guestPersonIds: string[];
  participantUserIds: string[];
}): Array<{ kind: RefKind; id: string }> {
  const refs: Array<{ kind: RefKind; id: string }> = [];
  const singleRefs: Array<[RefKind, string | null | undefined]> = [
    ["deal", input.dealId],
    ["lead", input.leadId],
    ["person", input.personId],
    ["organization", input.orgId],
    ["user", input.assigneeId],
  ];
  for (const [kind, id] of singleRefs) {
    if (id !== null && id !== undefined) refs.push({ kind, id });
  }
  for (const gid of input.guestPersonIds) refs.push({ kind: "person", id: gid });
  for (const uid of input.participantUserIds) refs.push({ kind: "user", id: uid });
  return refs;
}

// Build a DealVisibilitySession from a PermSetUser for assertReferenceVisible.
function toVisibilitySession(actor: PermSetUser) {
  return {
    userId: actor.id,
    isActive: actor.isActive,
    sessionLive: true,
    isAdmin: actor.type === "admin",
    visibilityGroupIds: Array.from(actor.groupIds),
    managedUserIds: Array.from(actor.managedUserIds ?? []),
  };
}

export async function createActivity(
  db: Db,
  actor: PermSetUser,
  raw: ActivityCreateInput,
  signal: AbortSignal,
  options: CreateActivityOptions = {},
): Promise<Result<Activity, AppError>> {
  // Parse at the boundary so defaulted fields (priority, dueAt, arrays) are always present.
  const input = activityCreateInput.parse(raw);
  const cf =
    options.customFieldValidation === undefined
      ? buildCustomFieldsSchema(await listDefs(db, "activity", {}, signal)).safeParse(
          input.customFields,
        )
      : options.customFieldValidation.parseByKey(input.customFields);
  if (!cf.success) {
    return err(
      new AppError(ERROR_IDS.CF_VALUE_INVALID, "custom fields invalid", {
        issues: cf.error.issues,
      }),
    );
  }

  const orderCheck = assertEndNotBeforeStart(input.dueAt, input.endAt);
  if (!orderCheck.ok) return orderCheck;

  const preferences = await activityAccountPreferences(db, actor.id);
  const civilDates = canonicalCreateDates(input, input.authoredTimeZone ?? preferences.timeZone);
  if (civilEndBeforeStart(civilDates))
    return err(
      new AppError(ERROR_IDS.ACTIVITY_END_BEFORE_START, "activity end is before its start", {}),
    );
  const refActor = toVisibilitySession(actor);

  const result = await activityTransaction(db, async (tx) => {
    const calendarAccess = await assertCalendarWritable(tx, actor, input.calendarId, signal);
    if (!calendarAccess.ok) return calendarAccess;
    // Validate all referenced entities are visible to the actor. A lead reference is gated
    // here too, so an actor cannot attach an activity to a lead they cannot see.
    const refs = collectReferences(input);
    for (const ref of refs) {
      const v = await assertReferenceVisible(tx, refActor, ref, signal);
      if (!v.ok) return v;
    }

    // Pipedrive parity: you cannot link a new activity to an archived deal.
    const guard = await assertDealNotArchived(tx, input.dealId, signal);
    if (!guard.ok) return guard;

    const [row] = await tx
      .insert(activities)
      .values({
        typeId: input.typeId,
        ...calendarCreateOwnership(input, preferences.timeZone),
        reminderAutomationEnabled: options.scheduleReminder !== false,
        subject: input.subject,
        calendarId: input.calendarId,
        eventVisibility: input.eventVisibility,
        availability: input.availability,
        priority: input.priority,
        dueAt: input.dueAt === null ? null : new Date(input.dueAt),
        ...civilDates,
        endAt: input.endAt === null ? null : new Date(input.endAt),
        durationMinutes: input.durationMinutes,
        ownerId: actor.id,
        assigneeId: input.assigneeId ?? actor.id,
        dealId: input.dealId,
        leadId: input.leadId,
        personId: input.personId,
        orgId: input.orgId,
        customFields: cf.data,
        location: input.location,
        note: sanitizeNote(input.note),
        videoCallUrl: input.videoCallUrl,
        done: input.done,
        doneAt: resolveDoneAt(input.done, options.doneAtOverride),
      })
      .returning();

    if (row === undefined) {
      return err(new AppError(ERROR_IDS.DB_INSERT_FAILED, "activity insert returned no rows", {}));
    }

    if (input.guestPersonIds.length > 0) {
      await tx
        .insert(activityGuests)
        .values(input.guestPersonIds.map((personId) => ({ activityId: row.id, personId })));
    }
    if (input.participantUserIds.length > 0) {
      await tx
        .insert(activityParticipants)
        .values(input.participantUserIds.map((userId) => ({ activityId: row.id, userId })));
    }

    if (
      input.reminder !== undefined ||
      input.authoredTimeZone !== undefined ||
      input.reminderTimeZone !== undefined
    ) {
      await synchronizeActivityReminder(
        tx,
        null,
        row,
        {
          eventTimeZone: input.authoredTimeZone,
          reminderTimeZone: input.reminderTimeZone,
          selection: options.scheduleReminder === false ? { kind: "none" } : input.reminder,
        },
        signal,
      );
    }

    if (row.dealId !== null) {
      await recomputeDealActivityDates(tx, row.dealId, signal);
    }

    const reminders = await applyActivityReminders(
      tx,
      actor,
      row,
      input.personalReminders,
      signal,
      options.scheduleReminder !== false,
    );
    if (!reminders.ok) return reminders;
    return ok(row);
  });

  if (
    result.ok === true &&
    options.scheduleReminder !== false &&
    input.reminder === undefined &&
    result.value.reminderEngine === "legacy"
  ) {
    await scheduleReminder(result.value.id, result.value.dueAt, signal);
  }
  return result;
}

export async function completeActivity(
  db: Db,
  actor: PermSetUser,
  id: string,
  done: boolean,
  signal: AbortSignal,
  expectedVersion?: number,
): Promise<Result<Activity, AppError>> {
  return activityTransaction(db, async (tx) => {
    const [current] = await tx
      .select()
      .from(activities)
      .where(and(eq(activities.id, id), isNull(activities.deletedAt)))
      .for("no key update");

    if (current === undefined) {
      return err(new AppError(ERROR_IDS.ACTIVITY_NOT_FOUND, "activity not found", { id }));
    }

    const allowed = await guardActivityMutation(
      tx,
      actor,
      current,
      "activity.complete",
      signal,
      current.done === done ? undefined : expectedVersion,
    );
    if (!allowed.ok) return allowed;

    // A retry must retain the acknowledged timestamp and avoid repeating linked writes.
    if (current.done === done) return ok(current);

    const [row] = await tx
      .update(activities)
      .set({ done, doneAt: done ? new Date() : null })
      .where(eq(activities.id, id))
      .returning();

    if (row === undefined) {
      return err(new AppError(ERROR_IDS.DB_INSERT_FAILED, "activity update returned no rows", {}));
    }

    if (done) await cancelActivityReminder(tx, row.id, signal);
    else await synchronizeActivityReminder(tx, current, row, {}, signal);

    if (row.dealId !== null) {
      await recomputeDealActivityDates(tx, row.dealId, signal);
    }

    await reconcileReminderIntent(tx, row, signal);
    return ok(row);
  });
}
