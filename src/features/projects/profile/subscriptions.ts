import { and, eq, exists } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { err, ok } from "@/types/result";
import { lockInternalProject, withInternalProjects } from "../access";
import type { ProjectResult } from "../contracts";
import { internalProjectItems } from "../schema";
import type { ProfileSubscriptionTarget } from "./contracts";
import { internalProjectItemSubscriptions as subscriptions } from "./schema";

function subscriptionKey(userId: string, itemId: typeof internalProjectItems.id | string) {
  return and(eq(subscriptions.userId, userId), eq(subscriptions.itemId, itemId));
}

export function itemSubscribedBy(db: Db, userId: string) {
  return exists(
    db
      .select({ itemId: subscriptions.itemId })
      .from(subscriptions)
      .where(subscriptionKey(userId, internalProjectItems.id)),
  );
}

function withItemSubscription(
  db: Db,
  session: NativeSessionRef,
  { projectId, itemId }: ProfileSubscriptionTarget,
  signal: AbortSignal,
  mutating: boolean,
  operation: (tx: Db, userId: string) => Promise<ProjectResult<{ subscribed: boolean }>>,
) {
  return withInternalProjects(db, session, signal, async (tx, actor) => {
    const access = await lockInternalProject(tx, actor, projectId, "read");
    if (!access.ok) return access;
    if (mutating && access.value.summary.archived) return err("project_forbidden");
    const item = internalProjectItems;
    const [current] = await tx
      .select({ id: item.id })
      .from(item)
      .where(and(eq(item.id, itemId), eq(item.projectId, projectId)));
    if (current === undefined) return err("project_unavailable");
    return operation(tx, actor.id);
  });
}

export function readProjectSubscription(
  db: Db,
  session: NativeSessionRef,
  target: ProfileSubscriptionTarget,
  signal: AbortSignal,
) {
  return withItemSubscription(db, session, target, signal, false, async (tx, userId) => {
    const [row] = await tx
      .select({ itemId: subscriptions.itemId })
      .from(subscriptions)
      .where(subscriptionKey(userId, target.itemId));
    return ok({ subscribed: row !== undefined });
  });
}

export function setProjectSubscription(
  db: Db,
  session: NativeSessionRef,
  input: ProfileSubscriptionTarget & { subscribed: boolean },
  signal: AbortSignal,
) {
  return withItemSubscription(db, session, input, signal, true, async (tx, userId) => {
    if (input.subscribed) {
      await tx.insert(subscriptions).values({ userId, itemId: input.itemId }).onConflictDoNothing();
    } else {
      await tx.delete(subscriptions).where(subscriptionKey(userId, input.itemId));
    }
    return ok({ subscribed: input.subscribed });
  });
}
