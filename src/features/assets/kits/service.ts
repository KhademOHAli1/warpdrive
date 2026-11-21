import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { lockDirectory } from "@/features/locations/service";
import type { HydratedActor } from "@/server/hydrateActor";
import type { AssetSite } from "../contracts";
import { custodyWorkspace } from "../custody/repository";
import { projectAssetsWorkspace } from "../projection";
import { assetRegisterData } from "../repository";
import { assetActor, assetSites, lockAssetRegister } from "../service";
import { emptyKitWorkspace, type KitCommand, type KitResult, kitCommand } from "./contracts";
import { kitWorkspace, persistKitChanges } from "./repository";
import { assetKitReceipts } from "./schema";
import { applyKitCommand } from "./transitions";

const unavailable = { ok: false, error: "unavailable" } as const;

class KitSessionExpired extends Error {}

async function project(tx: Db, sites: AssetSite[], kitId: string): Promise<KitResult> {
  const workspace = await projectAssetsWorkspace(tx, sites);
  return { ok: true, value: { ...workspace, kits: workspace.kits ?? emptyKitWorkspace() }, kitId };
}

async function applyCommand(tx: Db, actor: HydratedActor, command: KitCommand): Promise<KitResult> {
  const sites = await assetSites(tx, actor);
  const site = sites.find(({ id, canManage }) => id === command.siteId && canManage);
  if (site === undefined) return unavailable;
  const fingerprint = createHash("sha256").update(JSON.stringify(command)).digest("hex");
  const [receipt] = await tx
    .select()
    .from(assetKitReceipts)
    .where(
      and(
        eq(assetKitReceipts.actorId, actor.id),
        eq(assetKitReceipts.requestId, command.requestId),
      ),
    );
  if (receipt !== undefined) {
    if (receipt.siteId !== site.id || receipt.fingerprint !== fingerprint)
      return { ok: false, error: "conflict" };
    return project(tx, sites, receipt.kitId);
  }
  const before = {
    ...(await assetRegisterData(tx, [site.id], false)),
    sites: [site],
    custody: await custodyWorkspace(tx, [site], false),
    kits: await kitWorkspace(tx, [site.id], false),
  };
  const result = applyKitCommand(before, command, actor.name);
  if (!result.ok) return result;
  await persistKitChanges(tx, before, result.value, result.kitId, actor.id);
  await tx.insert(assetKitReceipts).values({
    actorId: actor.id,
    requestId: command.requestId,
    siteId: site.id,
    fingerprint,
    kitId: result.kitId,
  });
  return project(tx, sites, result.kitId);
}

export async function runKitCommand(
  db: Db,
  who: NativeSessionRef,
  raw: unknown,
  signal: AbortSignal,
): Promise<KitResult> {
  const parsed = kitCommand.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  try {
    return await withCurrentAuthority(db, "read", signal, async (tx) => {
      await lockDirectory(tx, "read", signal);
      const actor = await assetActor(tx, who, signal);
      if (actor === null) return unavailable;
      await lockAssetRegister(tx, "write", signal);
      const result = await applyCommand(tx, actor, parsed.data);
      if ((await assetActor(tx, who, signal)) === null) throw new KitSessionExpired();
      return result;
    });
  } catch (error) {
    if (error instanceof KitSessionExpired) return unavailable;
    throw error;
  }
}
