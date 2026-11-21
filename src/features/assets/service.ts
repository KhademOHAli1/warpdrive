import { createHash } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { directorySites } from "@/features/locations/schema";
import { lockDirectory } from "@/features/locations/service";
import {
  currentOperationsActor,
  operationsSiteCapabilities,
  readOperationsSiteGrants,
} from "@/features/operations-access/scope";
import type { HydratedActor } from "@/server/hydrateActor";
import { assetRoleSiteIds } from "./access";
import { commissionedAssetSerial } from "./commissioning/protection";
import { type AssetCommand, type AssetResult, type AssetSite, assetCommand } from "./contracts";
import { applyAssetWorkspaceCommand } from "./registerCommands";
import { assetRegisterData, persistAssetChanges } from "./repository";
import { assetCommandReceipts, assetRecords } from "./schema";

const unavailable = { ok: false, error: "unavailable" } as const;
const conflict = { ok: false, error: "conflict" } as const;

class AssetSessionExpired extends Error {}

export async function assetSites(tx: Db, actor: HydratedActor): Promise<AssetSite[]> {
  const isAdmin = actor.type === "admin";
  const grants = isAdmin ? [] : await readOperationsSiteGrants(tx, actor.id);
  const roleSites = assetRoleSiteIds(grants);
  if (!isAdmin && roleSites.length === 0) return [];
  const sites = await tx
    .select()
    .from(directorySites)
    .where(isAdmin ? undefined : inArray(directorySites.id, roleSites))
    .orderBy(asc(directorySites.code), asc(directorySites.id));
  return sites.map(({ id, code, name, archived }) => ({
    id,
    code,
    name,
    canManage: !archived && operationsSiteCapabilities(grants, isAdmin, id).canManageAssets,
  }));
}

export async function lockAssetRegister(tx: Db, mode: "read" | "write", signal: AbortSignal) {
  await tx.execute(
    mode === "read"
      ? sql`SELECT pg_advisory_xact_lock_shared(hashtext('warpdrive-assets'), hashtext('register-v1'))`
      : sql`SELECT pg_advisory_xact_lock(hashtext('warpdrive-assets'), hashtext('register-v1'))`,
  );
  signal.throwIfAborted();
}

async function assetActor(tx: Db, who: NativeSessionRef, signal: AbortSignal) {
  const actor = await currentOperationsActor(tx, who, signal);
  return actor?.projectsGuestOnly === true ? null : actor;
}

async function projectWorkspace(
  tx: Db,
  sites: AssetSite[],
  focusId: string | null = null,
): Promise<AssetResult> {
  const data = await assetRegisterData(
    tx,
    sites.map(({ id }) => id),
    true,
  );
  return { ok: true, value: { sites, ...data }, focusId };
}

export function readAssetsWorkspace(
  db: Db,
  who: NativeSessionRef,
  signal: AbortSignal,
): Promise<AssetResult> {
  return withCurrentAuthority(db, "read", signal, async (tx) => {
    await lockDirectory(tx, "read", signal);
    const actor = await assetActor(tx, who, signal);
    if (actor === null) return unavailable;
    await lockAssetRegister(tx, "read", signal);
    const result = await projectWorkspace(tx, await assetSites(tx, actor));
    return (await assetActor(tx, who, signal)) === null ? unavailable : result;
  });
}

async function commandSite(tx: Db, command: AssetCommand) {
  if ("siteId" in command) return command.siteId;
  const [row] = await tx
    .select({ siteId: assetRecords.siteId })
    .from(assetRecords)
    .where(eq(assetRecords.id, command.assetId));
  return row?.siteId;
}

async function applyCommand(
  tx: Db,
  actor: HydratedActor,
  command: AssetCommand,
): Promise<AssetResult> {
  const sites = await assetSites(tx, actor);
  const siteId = await commandSite(tx, command);
  const site = sites.find(({ id, canManage }) => id === siteId && canManage);
  if (site === undefined) return unavailable;

  const fingerprint = createHash("sha256").update(JSON.stringify(command)).digest("hex");
  const [receipt] = await tx
    .select()
    .from(assetCommandReceipts)
    .where(
      and(
        eq(assetCommandReceipts.actorId, actor.id),
        eq(assetCommandReceipts.requestId, command.requestId),
      ),
    );
  if (receipt !== undefined) {
    if (receipt.siteId !== site.id || receipt.fingerprint !== fingerprint) return conflict;
    return projectWorkspace(tx, sites, receipt.focusId);
  }

  const before = { sites: [site], ...(await assetRegisterData(tx, [site.id], false)) };
  if (command.type === "update") {
    const recorded = await commissionedAssetSerial(tx, command.assetId);
    if (recorded !== null && command.serial !== recorded) return { ok: false, error: "state" };
  }
  const transformed = applyAssetWorkspaceCommand(before, command, actor.name);
  if (!transformed.ok) return transformed;
  await persistAssetChanges(tx, before, transformed.value, actor.id);
  await tx.insert(assetCommandReceipts).values({
    actorId: actor.id,
    requestId: command.requestId,
    fingerprint,
    siteId: site.id,
    focusId: transformed.focusId,
  });
  return projectWorkspace(tx, sites, transformed.focusId);
}

export async function runAssetCommand(
  db: Db,
  who: NativeSessionRef,
  raw: unknown,
  signal: AbortSignal,
): Promise<AssetResult> {
  const parsed = assetCommand.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  try {
    return await withCurrentAuthority(db, "read", signal, async (tx) => {
      await lockDirectory(tx, "read", signal);
      const actor = await assetActor(tx, who, signal);
      if (actor === null) return unavailable;
      await lockAssetRegister(tx, "write", signal);
      const result = await applyCommand(tx, actor, parsed.data);
      if ((await assetActor(tx, who, signal)) === null) throw new AssetSessionExpired();
      return result;
    });
  } catch (error) {
    if (error instanceof AssetSessionExpired) return unavailable;
    throw error;
  }
}
