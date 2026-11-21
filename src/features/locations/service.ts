import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { users } from "@/db/schema/identity";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import { currentNativeActor, type NativeSessionRef } from "@/features/auth/currentNativeActor";
import { hasWarehouseStock } from "@/features/inventory/warehouse/snapshot";
import {
  type LocationsCommand,
  type LocationsError,
  type LocationsResult,
  type LocationsWorkspace,
  locationsCommand,
} from "./contracts";
import { applyLocationChange, type Location, type LocationChange, type Site } from "./directory";
import {
  directoryCommandReceipts,
  directoryLocations,
  directorySiteGrants,
  directorySites,
} from "./schema";

type Focus = { siteId: string; locationId: string | null };
type Failure = Extract<LocationsResult, { ok: false }>;
type Assignment = Extract<LocationsCommand, { type: "setGrant" }>;

function fail(error: LocationsError): Failure {
  return { ok: false, error };
}

class DirectorySessionExpired extends Error {}

// Lock order is native authority, then the directory. Readers share the directory lock to
// return one view of grants and locations. Writers serialize hierarchy and grant edges.
export async function lockDirectory(tx: Db, mode: "read" | "write", signal: AbortSignal) {
  await tx.execute(
    mode === "read"
      ? sql`SELECT pg_advisory_xact_lock_shared(hashtext('warpdrive-locations'), hashtext('directory-v1'))`
      : sql`SELECT pg_advisory_xact_lock(hashtext('warpdrive-locations'), hashtext('directory-v1'))`,
  );
  signal.throwIfAborted();
}

function acceptedStaff() {
  return and(eq(users.isActive, true), eq(users.projectsGuestOnly, false), isNull(users.invitedAt));
}

async function currentDirectoryActor(tx: Db, who: NativeSessionRef, signal: AbortSignal) {
  const current = await currentNativeActor(tx, who, signal);
  if (current === null) return null;
  const [accepted] = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, current.actor.id), acceptedStaff()));
  signal.throwIfAborted();
  return accepted === undefined ? null : current.actor;
}

async function projectDirectory(
  tx: Db,
  actorId: string,
  isAdmin: boolean,
): Promise<LocationsWorkspace> {
  const grants = await tx
    .select()
    .from(directorySiteGrants)
    .where(isAdmin ? undefined : eq(directorySiteGrants.userId, actorId))
    .orderBy(asc(directorySiteGrants.siteId), asc(directorySiteGrants.userId));
  const grantedSiteIds = grants.map(({ siteId }) => siteId);
  const sites = await tx
    .select()
    .from(directorySites)
    .where(isAdmin ? undefined : inArray(directorySites.id, grantedSiteIds))
    .orderBy(asc(directorySites.code));
  const locations = await tx
    .select()
    .from(directoryLocations)
    .where(isAdmin ? undefined : inArray(directoryLocations.siteId, grantedSiteIds))
    .orderBy(asc(directoryLocations.siteId), asc(directoryLocations.code));
  const eligibleUsers = isAdmin
    ? await tx
        .select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .where(and(acceptedStaff(), eq(users.isAdmin, false)))
        .orderBy(asc(users.name), asc(users.id))
    : [];
  const managedSiteIds = isAdmin
    ? sites.map(({ id }) => id)
    : grants.filter(({ role }) => role === "manager").map(({ siteId }) => siteId);
  return {
    directory: { sites, locations },
    canManageSites: isAdmin,
    managedSiteIds,
    grants: isAdmin ? grants : [],
    eligibleUsers,
  };
}

export async function readLocationsDirectory(
  db: Db,
  who: NativeSessionRef,
  signal: AbortSignal,
): Promise<LocationsResult> {
  return withCurrentAuthority(db, "read", signal, async (tx) => {
    await lockDirectory(tx, "read", signal);
    const actor = await currentDirectoryActor(tx, who, signal);
    if (actor === null) return fail("unavailable");
    const value = await projectDirectory(tx, actor.id, actor.type === "admin");
    if ((await currentDirectoryActor(tx, who, signal)) === null) return fail("unavailable");
    return { ok: true, value };
  });
}

function canApply(workspace: LocationsWorkspace, command: LocationsCommand): boolean {
  if (workspace.canManageSites) return true;
  const location =
    "id" in command && command.id !== null
      ? workspace.directory.locations.find(({ id }) => id === command.id)
      : undefined;

  if (command.type === "saveLocation") {
    return (
      workspace.managedSiteIds.includes(command.siteId) &&
      (command.id === null || location?.siteId === command.siteId)
    );
  }
  return (
    command.type === "setLocationArchived" &&
    location !== undefined &&
    workspace.managedSiteIds.includes(location.siteId)
  );
}

async function readReceipt(tx: Db, actorId: string, requestId: string) {
  const [receipt] = await tx
    .select({
      fingerprint: directoryCommandReceipts.fingerprint,
      siteId: directoryCommandReceipts.siteId,
      locationId: directoryCommandReceipts.locationId,
    })
    .from(directoryCommandReceipts)
    .where(
      and(
        eq(directoryCommandReceipts.actorId, actorId),
        eq(directoryCommandReceipts.requestId, requestId),
      ),
    );
  return receipt;
}

async function setGrant(
  tx: Db,
  workspace: LocationsWorkspace,
  { role, siteId, userId }: Assignment,
): Promise<Focus | Failure> {
  if (!workspace.directory.sites.some(({ id }) => id === siteId)) return fail("missingRecord");
  if (role === null) {
    await tx
      .delete(directorySiteGrants)
      .where(and(eq(directorySiteGrants.siteId, siteId), eq(directorySiteGrants.userId, userId)));
  } else {
    if (!workspace.eligibleUsers.some(({ id }) => id === userId)) return fail("invalidGrant");
    await tx
      .insert(directorySiteGrants)
      .values({ siteId, userId, role })
      .onConflictDoUpdate({
        target: [directorySiteGrants.siteId, directorySiteGrants.userId],
        set: { role },
      });
  }
  return { siteId, locationId: null };
}

async function saveSite(tx: Db, { id, ...values }: Site, create: boolean) {
  if (create) {
    await tx.insert(directorySites).values({ id, ...values });
  } else {
    await tx.update(directorySites).set(values).where(eq(directorySites.id, id));
  }
}

async function saveLocation(tx: Db, { id, siteId, ...values }: Location, create: boolean) {
  if (create) {
    await tx.insert(directoryLocations).values({ id, siteId, ...values });
  } else {
    await tx
      .update(directoryLocations)
      .set(values)
      .where(and(eq(directoryLocations.id, id), eq(directoryLocations.siteId, siteId)));
  }
}

async function applyDirectoryChange(
  tx: Db,
  workspace: LocationsWorkspace,
  command: LocationChange,
): Promise<Focus | Failure> {
  const result = applyLocationChange(workspace.directory, command, randomUUID);
  if (!result.ok) return result;
  const { siteId, locationId, directory } = result;
  if (directory === workspace.directory) return { siteId, locationId };

  if (
    (command.type === "setSiteArchived" || command.type === "setLocationArchived") &&
    command.archived &&
    (await hasWarehouseStock(tx, siteId, locationId))
  ) {
    return fail("warehouseStock");
  }

  if (locationId === null) {
    const site = directory.sites.find(({ id }) => id === siteId);
    if (site === undefined) {
      throw new AppError(ERROR_IDS.DB_INVARIANT, "Directory change omitted its site");
    }
    await saveSite(tx, site, command.type === "saveSite" && command.id === null);
  } else {
    const location = directory.locations.find(({ id }) => id === locationId);
    if (location === undefined) {
      throw new AppError(ERROR_IDS.DB_INVARIANT, "Directory change omitted its location");
    }
    await saveLocation(tx, location, command.type === "saveLocation" && command.id === null);
  }
  return { siteId, locationId };
}

async function applyCommand(
  tx: Db,
  actorId: string,
  workspace: LocationsWorkspace,
  command: LocationsCommand,
): Promise<Focus | Failure> {
  if (!canApply(workspace, command)) return fail("unavailable");

  // The strict parser canonicalizes keys, UUIDs and text before the fingerprint is built.
  const fingerprint = createHash("sha256").update(JSON.stringify(command)).digest("hex");
  const receipt = await readReceipt(tx, actorId, command.requestId);
  if (receipt !== undefined) {
    if (receipt.fingerprint !== fingerprint) return fail("requestConflict");
    return { siteId: receipt.siteId, locationId: receipt.locationId };
  }

  const effect =
    command.type === "setGrant"
      ? await setGrant(tx, workspace, command)
      : await applyDirectoryChange(tx, workspace, command);
  if ("ok" in effect) return effect;

  await tx
    .insert(directoryCommandReceipts)
    .values({ actorId, requestId: command.requestId, fingerprint, ...effect });
  return effect;
}

/** Directory changes and command receipts commit together under the current native authority. */
export async function executeLocationsCommand(
  db: Db,
  who: NativeSessionRef,
  rawCommand: unknown,
  signal: AbortSignal,
): Promise<LocationsResult> {
  const parsed = locationsCommand.safeParse(rawCommand);
  if (!parsed.success) return fail("invalidCommand");
  try {
    return await withCurrentAuthority(db, "read", signal, async (tx): Promise<LocationsResult> => {
      await lockDirectory(tx, "write", signal);
      const actor = await currentDirectoryActor(tx, who, signal);
      if (actor === null) return fail("unavailable");
      const isAdmin = actor.type === "admin";
      const scope = await projectDirectory(tx, actor.id, isAdmin);
      const effect = await applyCommand(tx, actor.id, scope, parsed.data);
      if ("ok" in effect) return effect;
      // Replays use the present scope and read projection rather than a stored response.
      const value = await projectDirectory(tx, actor.id, isAdmin);
      if ((await currentDirectoryActor(tx, who, signal)) === null) {
        throw new DirectorySessionExpired();
      }
      return { ok: true, value, ...effect };
    });
  } catch (error) {
    if (error instanceof DirectorySessionExpired) return fail("unavailable");
    throw error;
  }
}
