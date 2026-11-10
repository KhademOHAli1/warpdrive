import { and, asc, eq, ilike, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { deals, organizations, persons, users } from "@/db/schema";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import { currentNativeActor, type NativeSessionRef } from "@/features/auth/currentNativeActor";
import { can } from "@/features/permissions/can";
import { dealVisibilityPredicate } from "@/features/permissions/sql";
import { err, ok } from "@/types/result";
import { nativeProjectActor } from "./nativeAccess";
import { createNativeProjectRepository } from "./nativeProject";
import { checkProjectLocalAction } from "./projectLocalAccess";
import { agencyProjectSettings } from "./schema/agencyProjectSettings";
import { agencyProjectMembers } from "./schema/agencyProjects";

export async function projectLanding(db: Db, who: NativeSessionRef, signal: AbortSignal) {
  return withCurrentAuthority(db, "read", signal, async (tx) => {
    const current = await currentNativeActor(tx, who, signal);
    if (current === null) return null;
    const [staff] = await tx.select().from(users).where(eq(users.id, current.actor.id));
    if (staff?.invitedAt !== null) return null;
    const [setting] = await tx
      .select()
      .from(agencyProjectSettings)
      .where(eq(agencyProjectSettings.id, true));
    signal.throwIfAborted();
    return {
      actorId: current.actor.id,
      actorName: current.actor.name,
      enabled: setting?.enabled === true,
      canEnable: current.actor.type === "admin",
      canCreate: can(current.actor, "project.create"),
    };
  });
}

export async function enableNativeProjects(
  db: Db,
  who: NativeSessionRef,
  enabled: boolean,
  signal: AbortSignal,
) {
  return withCurrentAuthority(db, "write", signal, async (tx) => {
    const current = await currentNativeActor(tx, who, signal);
    if (current?.actor.type !== "admin") return err("project_unavailable" as const);
    const [staff] = await tx.select().from(users).where(eq(users.id, current.actor.id));
    if (staff?.invitedAt !== null) return err("project_unavailable" as const);
    await tx
      .insert(agencyProjectSettings)
      .values({ enabled })
      .onConflictDoUpdate({ target: agencyProjectSettings.id, set: { enabled } });
    signal.throwIfAborted();
    return ok(undefined);
  });
}

export async function projectCreationOptions(
  db: Db,
  who: NativeSessionRef,
  query: string,
  signal: AbortSignal,
) {
  return withCurrentAuthority(db, "read", signal, async (tx) => {
    const current = await nativeProjectActor(tx, who, signal);
    if (current === null || !can(current.actor, "project.create"))
      return err("project_unavailable" as const);
    const actor = current.actor;
    const visible = dealVisibilityPredicate(
      {
        userId: actor.id,
        isAdmin: actor.type === "admin",
        isActive: true,
        sessionLive: true,
        groupIds: [...actor.groupIds],
        managedUserIds: [...(actor.managedUserIds ?? [])],
      },
      {
        ownerId: sql`${organizations.ownerId}`,
        visibilityLevel: sql`${organizations.visibilityLevel}`,
        visibilityGroupId: sql`${organizations.visibilityGroupId}`,
        visibleToUserIds: sql`${organizations.visibleToUserIds}`,
        pipelineVisibilityGroupId: sql`NULL::uuid`,
      },
    );
    const clients = await tx
      .select({ id: organizations.id, label: organizations.name })
      .from(organizations)
      .where(
        and(
          visible,
          isNull(organizations.deletedAt),
          ilike(organizations.name, `%${query.replace(/[\\%_]/g, "\\$&")}%`),
        ),
      )
      .orderBy(asc(organizations.name), asc(organizations.id))
      .limit(50);
    const owners = await tx
      .select({ id: users.id, label: users.name })
      .from(users)
      .where(and(eq(users.isActive, true), isNull(users.invitedAt)))
      .orderBy(asc(users.name), asc(users.id))
      .limit(100);
    signal.throwIfAborted();
    return ok({ clients, owners });
  });
}

export async function projectWorkspace(
  db: Db,
  who: NativeSessionRef,
  projectId: string,
  signal: AbortSignal,
) {
  return withCurrentAuthority(db, "read", signal, async (tx) => {
    const result = await createNativeProjectRepository(tx, who).read(projectId, signal);
    if (!result.ok) return result;
    const project = result.value;
    const current = await nativeProjectActor(tx, who, signal);
    if (current === null) return err("project_unavailable" as const);
    const [owner] = await tx
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, project.ownerUserId));
    const [member] = await tx
      .select()
      .from(agencyProjectMembers)
      .where(
        and(
          eq(agencyProjectMembers.projectId, project.id),
          eq(agencyProjectMembers.userId, who.userId),
        ),
      );
    const labels: string[] = [];
    for (const [table, id, field] of [
      [deals, project.dealId, deals.title],
      [persons, project.personId, persons.name],
      [organizations, project.orgId, organizations.name],
    ] as const) {
      if (id === null) continue;
      const [row] = await tx.select({ label: field }).from(table).where(eq(table.id, id));
      if (row) labels.push(row.label);
    }
    signal.throwIfAborted();
    return ok({
      project,
      ownerLabel: owner?.name ?? null,
      contextLabel: labels.join(" / "),
      canStart:
        checkProjectLocalAction(
          {
            actor: current.actor,
            projectId: project.id,
            ownerUserId: project.ownerUserId,
            membership: member ?? null,
          },
          project,
          "start",
        ).ok && project.state === "planned",
    });
  });
}
