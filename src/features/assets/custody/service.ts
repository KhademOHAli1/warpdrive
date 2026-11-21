import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { lockDirectory } from "@/features/locations/service";
import type { HydratedActor } from "@/server/hydrateActor";
import type { AssetSite } from "../contracts";
import { assetRegisterData } from "../repository";
import { assetActor, assetSites, lockAssetRegister } from "../service";
import {
  type CustodyCommand,
  type CustodyOutcome,
  type CustodyResult,
  custodyCommand,
} from "./contracts";
import { custodyWorkspace, persistCustodyChanges } from "./repository";
import { assetCustodyReceipts } from "./schema";
import { applyCustodyCommand } from "./transitions";

const unavailable = { ok: false, error: "unavailable" } as const;

class CustodySessionExpired extends Error {}

async function project(
  tx: Db,
  sites: AssetSite[],
  outcomes: CustodyOutcome[],
): Promise<CustodyResult> {
  const assets = await assetRegisterData(
    tx,
    sites.map(({ id }) => id),
    true,
  );
  const custody = await custodyWorkspace(tx, sites, true);
  return { ok: true, value: { ...assets, sites, custody }, outcomes };
}

async function applyCommand(
  tx: Db,
  actor: HydratedActor,
  command: CustodyCommand,
): Promise<CustodyResult> {
  const sites = await assetSites(tx, actor);
  const site = sites.find(({ id, canManage }) => id === command.siteId && canManage);
  if (site === undefined) return unavailable;
  const fingerprint = createHash("sha256").update(JSON.stringify(command)).digest("hex");
  const [receipt] = await tx
    .select()
    .from(assetCustodyReceipts)
    .where(
      and(
        eq(assetCustodyReceipts.actorId, actor.id),
        eq(assetCustodyReceipts.requestId, command.requestId),
      ),
    );
  if (receipt !== undefined) {
    if (receipt.siteId !== site.id || receipt.fingerprint !== fingerprint)
      return { ok: false, error: "conflict" };
    return project(tx, sites, receipt.outcomes);
  }
  const assets = await assetRegisterData(tx, [site.id], false);
  const custody = await custodyWorkspace(tx, [site], false);
  const before = { ...assets, sites: [site], custody };
  const result = applyCustodyCommand(before, command, actor.name);
  if (!result.ok) return result;
  await persistCustodyChanges(tx, before, result.value, actor.id);
  await tx.insert(assetCustodyReceipts).values({
    actorId: actor.id,
    requestId: command.requestId,
    siteId: site.id,
    fingerprint,
    outcomes: result.outcomes,
  });
  return project(tx, sites, result.outcomes);
}

export async function runAssetCustodyCommand(
  db: Db,
  who: NativeSessionRef,
  raw: unknown,
  signal: AbortSignal,
): Promise<CustodyResult> {
  const parsed = custodyCommand.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  try {
    return await withCurrentAuthority(db, "read", signal, async (tx) => {
      await lockDirectory(tx, "read", signal);
      const actor = await assetActor(tx, who, signal);
      if (actor === null) return unavailable;
      await lockAssetRegister(tx, "write", signal);
      const result = await applyCommand(tx, actor, parsed.data);
      if ((await assetActor(tx, who, signal)) === null) throw new CustodySessionExpired();
      return result;
    });
  } catch (error) {
    if (error instanceof CustodySessionExpired) return unavailable;
    throw error;
  }
}
