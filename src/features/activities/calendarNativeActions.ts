"use server";

import type { z } from "zod";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { type Db, db } from "@/db/client";
import { guardCsrf } from "@/features/identity/actions/shared";
import { SIG } from "@/features/identity/actions/sig";
import { can } from "@/features/permissions/can";
import type { PermSetUser } from "@/features/permissions/effective";
import { err, type Result } from "@/types/result";
import { deleteActivity } from "./activityDelete";
import { updateActivity } from "./activityUpdate";
import { afterCalendarCommit } from "./calendarAfterCommit";
import { withCalendarActor } from "./calendarNativeAuthority";
import {
  calendarCompleteEnvelopeV1,
  calendarCreateEnvelopeV1,
  calendarEditEnvelopeV1,
  calendarReadEnvelopeV1,
  calendarRetryEnvelopeV1,
} from "./calendarNativeSchemas";
import { readCalendarRequestSession } from "./calendarRequestSession";
import { type EditableActivity, getActivityForEdit } from "./getForEdit";
import { retryActivityReminder } from "./reminderRetry";
import { completeActivity, createActivity } from "./repo";

type ActionResult<T> = { ok: true; value: T } | { ok: false; error: { id: string } };
interface ActorEnvelope {
  v: 1;
  expectedActorId: string;
}

async function command<I extends ActorEnvelope, T>(
  schema: z.ZodType<I>,
  raw: unknown,
  csrfToken: string | null,
  apply: (
    tx: Db,
    actor: PermSetUser,
    input: I,
    signal: AbortSignal,
  ) => Promise<Result<T, AppError>>,
): Promise<ActionResult<T>> {
  const csrf = await guardCsrf(csrfToken);
  if (!csrf.ok) return { ok: false, error: { id: "E_AUTH_CSRF" } };
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: { id: ERROR_IDS.ACTIVITY_NATIVE_INPUT_INVALID } };
  const signal = SIG();
  const who = await readCalendarRequestSession(db, signal);
  if (who === null) return { ok: false, error: { id: ERROR_IDS.AUTH_SESSION_DEAD } };
  const result = await withCalendarActor(
    db,
    who,
    parsed.data.expectedActorId,
    signal,
    (tx, actor) => apply(tx, actor, parsed.data, signal),
  );
  return result.ok
    ? { ok: true, value: result.value }
    : { ok: false, error: { id: result.error.id } };
}

export async function createCalendarEventAction(
  raw: unknown,
  csrf: string | null,
): Promise<ActionResult<{ id: string }>> {
  const result = await command(calendarCreateEnvelopeV1, raw, csrf, (tx, actor, input, signal) => {
    if (!can(actor, "activity.create"))
      return Promise.resolve(
        err(new AppError(ERROR_IDS.PERM_DENIED, "Activity creation forbidden")),
      );
    return createActivity(tx, actor, input.activity, signal);
  });
  if (!result.ok) return result;
  afterCalendarCommit(result.value.id, { activity: result.value, actorId: result.value.ownerId });
  return { ok: true, value: { id: result.value.id } };
}
export async function editCalendarEventAction(
  raw: unknown,
  csrf: string | null,
): Promise<ActionResult<{ id: string }>> {
  const result = await command(calendarEditEnvelopeV1, raw, csrf, (tx, actor, input, signal) =>
    updateActivity(tx, actor, input.activity, signal),
  );
  if (!result.ok) return result;
  afterCalendarCommit(result.value.id);
  return { ok: true, value: { id: result.value.id } };
}
export async function completeCalendarEventAction(
  raw: unknown,
  csrf: string | null,
): Promise<ActionResult<{ id: string }>> {
  const result = await command(calendarCompleteEnvelopeV1, raw, csrf, (tx, actor, input, signal) =>
    completeActivity(
      tx,
      actor,
      input.activity.id,
      input.activity.done,
      signal,
      input.activity.expectedVersion,
    ),
  );
  if (!result.ok) return result;
  afterCalendarCommit(result.value.id);
  return { ok: true, value: { id: result.value.id } };
}
export async function deleteCalendarEventAction(
  raw: unknown,
  csrf: string | null,
): Promise<ActionResult<{ id: string }>> {
  const result = await command(calendarReadEnvelopeV1, raw, csrf, (tx, actor, input, signal) =>
    deleteActivity(tx, actor, input.activityId, signal),
  );
  if (!result.ok) return result;
  afterCalendarCommit(result.value.id);
  return result;
}
export async function readCalendarEventAction(
  raw: unknown,
  csrf: string | null,
): Promise<ActionResult<EditableActivity>> {
  return command(calendarReadEnvelopeV1, raw, csrf, (tx, actor, input, signal) =>
    getActivityForEdit(tx, actor, input.activityId, signal),
  );
}
export async function retryCalendarReminderAction(
  raw: unknown,
  csrf: string | null,
): Promise<ActionResult<{ id: string }>> {
  const result = await command(calendarRetryEnvelopeV1, raw, csrf, (tx, actor, input, signal) =>
    retryActivityReminder(tx, actor, input.activityId, input.expectedGenerationId, signal),
  );
  if (!result.ok) return result;
  afterCalendarCommit(result.value.id);
  return result;
}
