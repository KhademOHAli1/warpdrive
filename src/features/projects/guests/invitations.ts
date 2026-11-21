import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { users } from "@/db/schema/identity";
import { agencyProjectMembers } from "@/features/agency-projects/schema/agencyProjects";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import {
  mintProjectsGuestInvitation,
  revokePendingProjectsGuestInvitation,
} from "@/features/auth/management/invitations";
import type { PermSetUser } from "@/features/permissions/effective";
import { err, ok } from "@/types/result";
import { lockInternalProject, withInternalProjects } from "../access";
import type { InviteProjectGuest, ProjectGuestInvitation } from "./contracts";

export function inviteProjectGuest(
  db: Db,
  session: NativeSessionRef,
  input: InviteProjectGuest,
  signal: AbortSignal,
) {
  const { projectId, name, locale } = input;
  const email = input.email.trim().toLowerCase();
  return withInternalProjects<ProjectGuestInvitation>(db, session, signal, async (tx, actor) => {
    const access = await lockInternalProject(tx, actor, projectId, "write");
    if (!access.ok) return access;
    if (!access.value.canManageMembers) return err("project_forbidden");
    // A project invitation never adopts a pre-existing account or its login credentials.
    const [invited] = await tx
      .insert(users)
      .values({ email, name, invitedAt: new Date(), projectsGuestOnly: true })
      .onConflictDoNothing({ target: users.email })
      .returning({ userId: users.id });
    if (invited === undefined) return ok({ outcome: "email_unavailable" });
    await tx
      .insert(agencyProjectMembers)
      .values({ projectId, userId: invited.userId, projectGuest: true });
    const invitation = await mintProjectsGuestInvitation(
      tx,
      actor,
      { userId: invited.userId, email, locale },
      signal,
    );
    return ok({ outcome: "invited", ...invitation });
  });
}
export async function revokeInvitationWithoutGuestSeat(
  db: Db,
  actor: PermSetUser,
  userId: string,
  signal: AbortSignal,
) {
  const [retained] = await db
    .select({ userId: agencyProjectMembers.userId })
    .from(agencyProjectMembers)
    .where(
      and(eq(agencyProjectMembers.userId, userId), eq(agencyProjectMembers.projectGuest, true)),
    )
    .limit(1);
  if (retained === undefined) await revokePendingProjectsGuestInvitation(db, actor, userId, signal);
}
