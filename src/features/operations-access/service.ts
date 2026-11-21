import { and, asc, eq, exists, or, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { users } from "@/db/schema/identity";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { directorySites } from "@/features/locations/schema";
import {
  type OperationsAccessCommand,
  type OperationsAccessResult,
  operationsAccessCommand,
} from "./contracts";
import { operationsAccessReceipts, operationsSiteGrants } from "./schema";
import { currentOperationsActor } from "./scope";

const unavailable = { ok: false, error: "unavailable" } as const;
const invalid = { ok: false, error: "invalid" } as const;
const conflict = { ok: false, error: "conflict" } as const;
const eligibleStaff = sql<boolean>`
  ${users.isActive} AND NOT ${users.isAdmin} AND NOT ${users.projectsGuestOnly}
  AND ${users.invitedAt} IS NULL
`;

class AccessSessionExpired extends Error {}

async function projectWorkspace(tx: Db) {
  const sites = await tx.select().from(directorySites).orderBy(asc(directorySites.code));
  const staff = await tx
    .select({ id: users.id, name: users.name, email: users.email, eligible: eligibleStaff })
    .from(users)
    .where(
      or(
        eligibleStaff,
        exists(
          tx
            .select({ userId: operationsSiteGrants.userId })
            .from(operationsSiteGrants)
            .where(eq(operationsSiteGrants.userId, users.id)),
        ),
      ),
    )
    .orderBy(asc(users.name), asc(users.id));
  const grants = await tx
    .select()
    .from(operationsSiteGrants)
    .orderBy(
      asc(operationsSiteGrants.siteId),
      asc(operationsSiteGrants.userId),
      asc(operationsSiteGrants.role),
    );
  return { sites, staff, grants };
}

export function readOperationsAccessWorkspace(
  db: Db,
  who: NativeSessionRef,
  signal: AbortSignal,
): Promise<OperationsAccessResult> {
  return withCurrentAuthority(db, "read", signal, async (tx) => {
    const actor = await currentOperationsActor(tx, who, signal);
    if (actor?.type !== "admin") return unavailable;
    const value = await projectWorkspace(tx);
    if ((await currentOperationsActor(tx, who, signal))?.type !== "admin") return unavailable;
    return { ok: true, value };
  });
}

async function readReceipt(tx: Db, actorId: string, requestId: string) {
  const [receipt] = await tx
    .select({
      siteId: operationsAccessReceipts.siteId,
      userId: operationsAccessReceipts.userId,
      role: operationsAccessReceipts.role,
      enabled: operationsAccessReceipts.enabled,
    })
    .from(operationsAccessReceipts)
    .where(
      and(
        eq(operationsAccessReceipts.actorId, actorId),
        eq(operationsAccessReceipts.requestId, requestId),
      ),
    );
  return receipt;
}

async function setGrant(
  tx: Db,
  { siteId, userId, role, enabled }: OperationsAccessCommand,
): Promise<boolean> {
  const rows = enabled
    ? await tx
        .insert(operationsSiteGrants)
        .values({ siteId, userId, role })
        .onConflictDoNothing()
        .returning({ role: operationsSiteGrants.role })
    : await tx
        .delete(operationsSiteGrants)
        .where(
          and(
            eq(operationsSiteGrants.siteId, siteId),
            eq(operationsSiteGrants.userId, userId),
            eq(operationsSiteGrants.role, role),
          ),
        )
        .returning({ role: operationsSiteGrants.role });
  return rows.length > 0;
}

async function applyGrant(tx: Db, actorId: string, command: OperationsAccessCommand) {
  const { siteId, userId, role, enabled, requestId } = command;
  const receipt = await readReceipt(tx, actorId, requestId);
  if (receipt !== undefined) {
    return receipt.siteId === siteId &&
      receipt.userId === userId &&
      receipt.role === role &&
      receipt.enabled === enabled
      ? null
      : conflict;
  }

  const [target] = await tx
    .select({ archived: directorySites.archived, eligible: eligibleStaff })
    .from(directorySites)
    .innerJoin(users, eq(users.id, userId))
    .where(eq(directorySites.id, siteId));
  if (target === undefined || (enabled && (target.archived || !target.eligible))) return invalid;

  const changed = await setGrant(tx, command);
  await tx
    .insert(operationsAccessReceipts)
    .values({ actorId, requestId, siteId, userId, role, enabled, changed });
  return null;
}

export async function executeOperationsAccessCommand(
  db: Db,
  who: NativeSessionRef,
  raw: unknown,
  signal: AbortSignal,
): Promise<OperationsAccessResult> {
  const parsed = operationsAccessCommand.safeParse(raw);
  if (!parsed.success) return invalid;
  try {
    return await withCurrentAuthority(db, "write", signal, async (tx) => {
      const actor = await currentOperationsActor(tx, who, signal);
      if (actor?.type !== "admin") return unavailable;
      const failure = await applyGrant(tx, actor.id, parsed.data);
      if (failure !== null) return failure;
      // Replay reads current assignments and never restores a grant revoked after the original.
      const value = await projectWorkspace(tx);
      if ((await currentOperationsActor(tx, who, signal))?.type !== "admin") {
        throw new AccessSessionExpired();
      }
      return { ok: true, value };
    });
  } catch (error) {
    if (error instanceof AccessSessionExpired) return unavailable;
    throw error;
  }
}
