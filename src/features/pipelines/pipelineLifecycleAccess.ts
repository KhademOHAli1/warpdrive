import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { authUsers, permissionSets, sessions, users, visibilityGroupMembers } from "@/db/schema";
import { resolveWorkflowSession } from "@/features/auth/better/sessionPolicy";
import type { PermSetUser } from "@/features/permissions/effective";
import { hydrateActor } from "@/server/hydrateActor";
import { canManagePipelines } from "./canManagePipelines";

// Native auth remains the authority. Row locks keep revocation/role/group changes from
// committing across the final check and the pipeline write in this transaction.
export async function lockLifecycleActor(
  db: Db,
  requestHeaders: Headers,
  signal: AbortSignal,
): Promise<PermSetUser | null> {
  const initial = await resolveWorkflowSession(db, requestHeaders, signal, { requireFresh: true });
  if (initial === null) return null;
  await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.id, initial.session.id))
    .for("share");
  const [user] = await db.select().from(users).where(eq(users.id, initial.user.id)).for("share");
  if (user === undefined) return null;
  await db
    .select({ id: authUsers.id })
    .from(authUsers)
    .where(eq(authUsers.id, user.id))
    .for("share");
  if (user.permissionSetId !== null)
    await db
      .select({ id: permissionSets.id })
      .from(permissionSets)
      .where(eq(permissionSets.id, user.permissionSetId))
      .for("share");
  await db
    .select({ id: visibilityGroupMembers.groupId })
    .from(visibilityGroupMembers)
    .where(eq(visibilityGroupMembers.userId, user.id))
    .for("share");
  signal.throwIfAborted();
  const current = await resolveWorkflowSession(db, requestHeaders, signal, { requireFresh: true });
  return current === null ? null : hydrateActor(db, current.user.id, signal);
}

export function canManagePipelineScope(actor: PermSetUser, groupId: string | null): boolean {
  return (
    actor.isActive &&
    canManagePipelines(actor) &&
    (actor.type === "admin" || groupId === null || actor.groupIds.has(groupId))
  );
}
