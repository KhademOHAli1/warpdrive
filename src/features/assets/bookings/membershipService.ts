import { createHash } from "node:crypto";
import { and, asc, eq, exists, or, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { users } from "@/db/schema/identity";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { directorySites } from "@/features/locations/schema";
import { lockDirectory } from "@/features/locations/service";
import { assetActor } from "../service";
import {
  type BookingMembershipCommand,
  type BookingMembershipResult,
  type BookingMembershipWorkspace,
  bookingMembershipCommand,
} from "./membershipContracts";
import { assetBookingMemberships, assetBookingReceipts } from "./schema";

const unavailable = { ok: false, error: "unavailable" } as const;
const conflict = { ok: false, error: "conflict" } as const;
const invalid = { ok: false, error: "invalid" } as const;
const eligible = sql<boolean>`
  ${users.isActive} AND NOT ${users.isAdmin} AND NOT ${users.projectsGuestOnly}
  AND ${users.invitedAt} IS NULL
`;

class MembershipSessionExpired extends Error {}

async function project(tx: Db): Promise<BookingMembershipWorkspace> {
  const sites = await tx
    .select({
      id: directorySites.id,
      code: directorySites.code,
      name: directorySites.name,
      archived: directorySites.archived,
    })
    .from(directorySites)
    .orderBy(asc(directorySites.code), asc(directorySites.id));
  const staff = await tx
    .select({ id: users.id, name: users.name, eligible })
    .from(users)
    .where(
      or(
        eligible,
        exists(
          tx
            .select({ id: assetBookingMemberships.userId })
            .from(assetBookingMemberships)
            .where(eq(assetBookingMemberships.userId, users.id)),
        ),
      ),
    )
    .orderBy(asc(users.name), asc(users.id));
  const memberships = await tx
    .select()
    .from(assetBookingMemberships)
    .orderBy(asc(assetBookingMemberships.siteId), asc(assetBookingMemberships.userId));
  return { sites, staff, memberships };
}

export function readBookingMemberships(
  db: Db,
  who: NativeSessionRef,
  signal: AbortSignal,
): Promise<BookingMembershipResult> {
  return withCurrentAuthority(db, "read", signal, async (tx) => {
    await lockDirectory(tx, "read", signal);
    if ((await assetActor(tx, who, signal))?.type !== "admin") return unavailable;
    const value = await project(tx);
    return (await assetActor(tx, who, signal))?.type === "admin"
      ? { ok: true, value }
      : unavailable;
  });
}

async function updateMembership(tx: Db, actorId: string, command: BookingMembershipCommand) {
  const { requestId, siteId, userId, role } = command;
  const fingerprint = createHash("sha256")
    .update("booking-membership\u0000")
    .update(JSON.stringify(command))
    .digest("hex");
  const [receipt] = await tx
    .select()
    .from(assetBookingReceipts)
    .where(
      and(eq(assetBookingReceipts.actorId, actorId), eq(assetBookingReceipts.requestId, requestId)),
    );
  if (receipt !== undefined) {
    return receipt.siteId === siteId && receipt.fingerprint === fingerprint ? null : conflict;
  }
  const [target] = await tx
    .select({ archived: directorySites.archived, eligible })
    .from(directorySites)
    .innerJoin(users, eq(users.id, userId))
    .where(eq(directorySites.id, siteId));
  if (target === undefined || (role !== null && (target.archived || !target.eligible)))
    return invalid;
  if (role === null) {
    await tx
      .delete(assetBookingMemberships)
      .where(
        and(eq(assetBookingMemberships.siteId, siteId), eq(assetBookingMemberships.userId, userId)),
      );
  } else {
    await tx
      .insert(assetBookingMemberships)
      .values({ siteId, userId, role })
      .onConflictDoUpdate({
        target: [assetBookingMemberships.siteId, assetBookingMemberships.userId],
        set: { role },
      });
  }
  await tx
    .insert(assetBookingReceipts)
    .values({ actorId, requestId, siteId, fingerprint, bookingId: null });
  return null;
}

export async function runBookingMembershipCommand(
  db: Db,
  who: NativeSessionRef,
  raw: unknown,
  signal: AbortSignal,
): Promise<BookingMembershipResult> {
  const parsed = bookingMembershipCommand.safeParse(raw);
  if (!parsed.success) return invalid;
  try {
    return await withCurrentAuthority(db, "write", signal, async (tx) => {
      await lockDirectory(tx, "read", signal);
      const actor = await assetActor(tx, who, signal);
      if (actor?.type !== "admin") return unavailable;
      const error = await updateMembership(tx, actor.id, parsed.data);
      if (error !== null) return error;
      const value = await project(tx);
      if ((await assetActor(tx, who, signal))?.type !== "admin")
        throw new MembershipSessionExpired();
      return { ok: true, value };
    });
  } catch (error) {
    if (error instanceof MembershipSessionExpired) return unavailable;
    throw error;
  }
}
