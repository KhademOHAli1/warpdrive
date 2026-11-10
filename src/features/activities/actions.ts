"use server";

import { ERROR_IDS } from "@/constants/errorIds";
import { db } from "@/db/client";
import { guardCsrf } from "@/features/identity/actions/shared";
import { SIG } from "@/features/identity/actions/sig";
import { can } from "@/features/permissions/can";
import { createContext } from "@/server/trpc/context";
import { deleteActivity } from "./activityDelete";
import { updateActivity } from "./activityUpdate";
import { type CompleteActivityInput, completeActivityInput } from "./completeActivityInput";
import { notifyOnActivityCreated } from "./notifyHelpers";
import { completeActivity, createActivity } from "./repo";
import type { ActivityCreateInput, ActivityUpdateInput } from "./schemas";
import { activityManageInput } from "./schemas";

type ActionResult =
  | { ok: true; value: { id: string }; version?: number }
  | { ok: false; error: { id: string } };

export async function createActivityAction(
  input: ActivityCreateInput,
  csrfToken: string | null = null,
): Promise<ActionResult> {
  const csrfOk = await guardCsrf(csrfToken);
  if (!csrfOk.ok) return { ok: false, error: { id: "E_AUTH_CSRF" } };

  const { actor } = await createContext();
  if (actor === null) return { ok: false, error: { id: ERROR_IDS.AUTH_SESSION_DEAD } };

  if (!can(actor, "activity.create")) {
    return { ok: false, error: { id: ERROR_IDS.PERM_DENIED } };
  }

  const result = await createActivity(db, actor, input, SIG());
  if (!result.ok) return { ok: false, error: { id: result.error.id } };

  await notifyOnActivityCreated(db, { activity: result.value, actorId: actor.id, signal: SIG() });

  return { ok: true, value: { id: result.value.id }, version: result.value.version };
}

export async function completeActivityAction(
  input: CompleteActivityInput,
  csrfToken: string | null = null,
): Promise<ActionResult> {
  const csrfOk = await guardCsrf(csrfToken);
  if (!csrfOk.ok) return { ok: false, error: { id: "E_AUTH_CSRF" } };

  const { actor } = await createContext();
  if (actor === null) return { ok: false, error: { id: ERROR_IDS.AUTH_SESSION_DEAD } };

  const parsed = completeActivityInput.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: { id: ERROR_IDS.ACTIVITY_COMPLETE_INPUT_INVALID } };

  // Record-scoped: completeActivity gates via can(actor, "activity.complete", vis).
  const result = await completeActivity(
    db,
    actor,
    parsed.data.id,
    parsed.data.done,
    SIG(),
    ...(parsed.data.expectedVersion === undefined ? [] : [parsed.data.expectedVersion]),
  );
  if (!result.ok) return { ok: false, error: { id: result.error.id } };
  return {
    ok: true,
    value: { id: result.value.id },
    ...(typeof result.value.version === "number" ? { version: result.value.version } : {}),
  };
}

export async function editActivityAction(
  input: ActivityUpdateInput,
  csrfToken: string | null = null,
): Promise<ActionResult> {
  const csrfOk = await guardCsrf(csrfToken);
  if (!csrfOk.ok) return { ok: false, error: { id: "E_AUTH_CSRF" } };

  const { actor } = await createContext();
  if (actor === null) return { ok: false, error: { id: ERROR_IDS.AUTH_SESSION_DEAD } };

  // Record-scoped: updateActivity gates via can(actor, "activity.edit", vis).
  const result = await updateActivity(db, actor, input, SIG());
  if (!result.ok) return { ok: false, error: { id: result.error.id } };
  return { ok: true, value: { id: result.value.id }, version: result.value.version };
}

export async function deleteActivityAction(
  input: { id: string; expectedVersion?: number },
  csrfToken: string | null = null,
): Promise<ActionResult> {
  const csrfOk = await guardCsrf(csrfToken);
  if (!csrfOk.ok) return { ok: false, error: { id: "E_AUTH_CSRF" } };

  const parsed = activityManageInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: { id: ERROR_IDS.ACTIVITY_UPDATE_INPUT_INVALID } };

  const { actor } = await createContext();
  if (actor === null) return { ok: false, error: { id: ERROR_IDS.AUTH_SESSION_DEAD } };

  // Record-scoped: deleteActivity gates via can(actor, "activity.delete", vis).
  const result = await deleteActivity(
    db,
    actor,
    parsed.data.id,
    SIG(),
    parsed.data.expectedVersion,
  );
  if (!result.ok) return { ok: false, error: { id: result.error.id } };
  return { ok: true, value: { id: result.value.id } };
}
