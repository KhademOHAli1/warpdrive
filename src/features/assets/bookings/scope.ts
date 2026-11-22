import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { users } from "@/db/schema/identity";
import { directorySites } from "@/features/locations/schema";
import { operationsSiteGrants } from "@/features/operations-access/schema";
import { readOperationsSiteGrants } from "@/features/operations-access/scope";
import type { HydratedActor } from "@/server/hydrateActor";
import type { BookingParticipant, BookingPolicy, BookingRole, BookingSite } from "./contracts";
import { assetBookingMemberships, assetBookingPolicies } from "./schema";

function defaultPolicy(): BookingPolicy {
  return {
    timeZone: "UTC",
    baseApproval: false,
    selfServiceApproval: false,
    minNoticeMinutes: 0,
    maxDurationMinutes: null,
    skipClosedDays: false,
    workingHours: {
      enabled: false,
      weekly: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
        weekday,
        hours: weekday <= 5 ? { opensAt: "08:00", closesAt: "17:00" } : null,
      })),
      overrides: [],
    },
  };
}

export async function readBookingRoles(tx: Db, actorId: string) {
  const memberships = await tx
    .select({ siteId: assetBookingMemberships.siteId, role: assetBookingMemberships.role })
    .from(assetBookingMemberships)
    .where(eq(assetBookingMemberships.userId, actorId));
  const scope = new Map<string, BookingRole>(memberships.map(({ siteId, role }) => [siteId, role]));
  const operations = await readOperationsSiteGrants(tx, actorId);
  for (const { siteId, role } of operations) {
    if (role === "asset_manager") scope.set(siteId, "manager");
    if (role === "asset_viewer" && !scope.has(siteId)) scope.set(siteId, "viewer");
  }
  return scope;
}

export async function canBrowseBookings(tx: Db, actor: HydratedActor) {
  if (!actor.isActive || actor.projectsGuestOnly === true) return false;
  if (actor.type === "admin") return true;
  return (await readBookingRoles(tx, actor.id)).size > 0;
}

type ParticipantRow = BookingParticipant & { siteId: string };
async function participants(tx: Db, siteIds: string[]) {
  const siteRoster = new Map<string, ParticipantRow[]>();
  if (siteIds.length === 0) return siteRoster;
  const eligible = and(
    eq(users.isActive, true),
    eq(users.projectsGuestOnly, false),
    isNull(users.invitedAt),
  );
  const roster = await tx
    .select({
      id: users.id,
      name: users.name,
      siteId: assetBookingMemberships.siteId,
      role: assetBookingMemberships.role,
    })
    .from(assetBookingMemberships)
    .innerJoin(users, eq(users.id, assetBookingMemberships.userId))
    .where(and(inArray(assetBookingMemberships.siteId, siteIds), eligible))
    .orderBy(asc(users.name), asc(users.id));
  const operators = await tx
    .select({ id: users.id, name: users.name, siteId: operationsSiteGrants.siteId })
    .from(operationsSiteGrants)
    .innerJoin(users, eq(users.id, operationsSiteGrants.userId))
    .where(
      and(
        inArray(operationsSiteGrants.siteId, siteIds),
        eq(operationsSiteGrants.role, "asset_manager"),
        eligible,
      ),
    )
    .orderBy(asc(users.name), asc(users.id));
  for (const role of [
    ...roster,
    ...operators.map((row) => ({ ...row, role: "manager" as const })),
  ]) {
    const previous = siteRoster.get(role.siteId) ?? [];
    siteRoster.set(role.siteId, [...previous.filter(({ id }) => id !== role.id), role]);
  }
  return siteRoster;
}

export async function bookingSites(tx: Db, actor: HydratedActor): Promise<BookingSite[]> {
  const admin = actor.type === "admin";
  const roles = admin ? new Map<string, BookingRole>() : await readBookingRoles(tx, actor.id);
  if (!admin && roles.size === 0) return [];
  const directory = await tx
    .select({
      id: directorySites.id,
      code: directorySites.code,
      name: directorySites.name,
      archived: directorySites.archived,
      policy: assetBookingPolicies.policy,
      policyVersion: assetBookingPolicies.version,
    })
    .from(directorySites)
    .leftJoin(assetBookingPolicies, eq(assetBookingPolicies.siteId, directorySites.id))
    .where(admin ? undefined : inArray(directorySites.id, [...roles.keys()]))
    .orderBy(asc(directorySites.code), asc(directorySites.id));
  const managed = directory
    .filter(({ id }) => admin || roles.get(id) === "manager")
    .map(({ id }) => id);
  const roster = await participants(tx, managed);
  return directory.map(({ id, code, name, archived, policy, policyVersion }) => ({
    id,
    code,
    name,
    archived,
    role: admin ? "manager" : (roles.get(id) ?? "viewer"),
    canConfigure: admin && !archived,
    policyVersion: policyVersion ?? 0,
    policy: policy ?? defaultPolicy(),
    participants: (roster.get(id) ?? []).map(({ id, name, role }) => ({ id, name, role })),
  }));
}
