import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { deals, persons, users } from "@/db/schema";
import { currentNativeActor, type NativeSessionRef } from "@/features/auth/currentNativeActor";
import type { PermSetUser } from "@/features/permissions/effective";
import { assertReferenceVisible } from "@/features/permissions/referenceCheck";
import { hydrateActor } from "@/server/hydrateActor";
import type { ProjectCreateInput } from "./projectCreationInput";
import { agencyProjectSettings } from "./schema/agencyProjectSettings";

export async function nativeProjectActor(db: Db, who: NativeSessionRef, signal: AbortSignal) {
  const current = await currentNativeActor(db, who, signal);
  if (current === null) return null;
  const [staff] = await db.select().from(users).where(eq(users.id, current.actor.id));
  const [settings] = await db
    .select()
    .from(agencyProjectSettings)
    .where(eq(agencyProjectSettings.id, true));
  signal.throwIfAborted();
  return staff?.invitedAt === null && settings?.enabled === true ? { ...current, staff } : null;
}

function conflictingLink(left: string | null, right: string | null) {
  return left !== null && right !== null && left !== right;
}

export async function visibleProjectAnchors(
  db: Db,
  actor: PermSetUser,
  input: Pick<ProjectCreateInput, "dealId" | "personId" | "orgId">,
  signal: AbortSignal,
): Promise<boolean> {
  const session = {
    userId: actor.id,
    isAdmin: actor.type === "admin",
    isActive: actor.isActive,
    sessionLive: true,
    visibilityGroupIds: [...actor.groupIds],
    managedUserIds: [...(actor.managedUserIds ?? [])],
  };
  const anchors = [
    { kind: "deal" as const, id: input.dealId },
    { kind: "person" as const, id: input.personId },
    { kind: "organization" as const, id: input.orgId },
  ];
  if (anchors.every((anchor) => anchor.id === null)) return false;
  for (const anchor of anchors) {
    if (anchor.id === null) continue;
    if (
      !(await assertReferenceVisible(db, session, { kind: anchor.kind, id: anchor.id }, signal)).ok
    )
      return false;
  }
  if (input.dealId !== null) {
    const [deal] = await db
      .select({ personId: deals.personId, orgId: deals.orgId })
      .from(deals)
      .where(eq(deals.id, input.dealId));
    if (
      deal === undefined ||
      conflictingLink(input.personId, deal.personId) ||
      conflictingLink(input.orgId, deal.orgId)
    )
      return false;
  }
  if (input.personId !== null && input.orgId !== null) {
    const [person] = await db
      .select({ orgId: persons.orgId })
      .from(persons)
      .where(eq(persons.id, input.personId));
    if (person === undefined || (person.orgId !== null && person.orgId !== input.orgId))
      return false;
  }
  signal.throwIfAborted();
  return true;
}

export async function nativeProjectOwner(db: Db, id: string, signal: AbortSignal) {
  const [staff] = await db.select().from(users).where(eq(users.id, id));
  if (staff === undefined || !staff.isActive || staff.invitedAt !== null) return null;
  const actor = await hydrateActor(db, id, signal);
  return actor === null ? null : { staff, actor };
}
