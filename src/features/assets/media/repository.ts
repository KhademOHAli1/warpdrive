import { and, desc, eq } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { users } from "@/db/schema/identity";
import type { AssetMediaTarget } from "./contracts";
import {
  assetMediaEvents as events,
  assetMediaReceipts as receipts,
  assetMediaTargets as targets,
} from "./schema";

type Event = typeof events.$inferSelect;
export type StoredAssetMediaEvent = Omit<Event, "actorId" | "siteId" | "targetId"> & {
  actor: string;
};

function invariant(message: string): never {
  throw new AppError(ERROR_IDS.DB_INVARIANT, message);
}

function targetMatches(siteId: string, target: AssetMediaTarget) {
  const targetColumn = target.type === "asset" ? targets.assetId : targets.modelId;
  return and(
    eq(targets.siteId, siteId),
    eq(targets.targetType, target.type),
    eq(targetColumn, target.id),
  );
}

export async function readAssetMediaEvents(
  tx: Db,
  siteId: string,
  target: AssetMediaTarget,
): Promise<StoredAssetMediaEvent[]> {
  const rows = await tx
    .select({
      id: events.id,
      version: events.version,
      type: events.type,
      fileId: events.fileId,
      at: events.at,
      kind: events.kind,
      name: events.name,
      mime: events.mime,
      sizeBytes: events.sizeBytes,
      sha256: events.sha256,
      objectKey: events.objectKey,
      actor: users.name,
    })
    .from(events)
    .innerJoin(targets, and(eq(events.targetId, targets.id), eq(events.siteId, targets.siteId)))
    .leftJoin(users, eq(events.actorId, users.id))
    .where(targetMatches(siteId, target))
    .orderBy(desc(events.version));
  return rows.map(({ actor, ...event }) => ({ ...event, actor: actor ?? "" }));
}

export async function readAssetMediaReceipt(tx: Db, actorId: string, requestId: string) {
  const [row] = await tx
    .select({
      siteId: receipts.siteId,
      fingerprint: receipts.fingerprint,
      eventId: receipts.eventId,
      type: targets.targetType,
      assetId: targets.assetId,
      modelId: targets.modelId,
    })
    .from(receipts)
    .innerJoin(targets, and(eq(receipts.targetId, targets.id), eq(receipts.siteId, targets.siteId)))
    .where(and(eq(receipts.actorId, actorId), eq(receipts.requestId, requestId)));
  if (row === undefined) return undefined;
  const { siteId, fingerprint, eventId, type, assetId, modelId } = row;
  const id = type === "asset" ? assetId : modelId;
  if (id === null) invariant("A media receipt lost its equipment target");
  return { siteId, fingerprint, eventId, target: { type, id } };
}

type Persisted = {
  siteId: string;
  target: AssetMediaTarget;
  event: Omit<StoredAssetMediaEvent, "actor">;
  actorId: string;
  requestId: string;
  fingerprint: string;
};

/** Caller holds the current-authority, directory, Asset and media request/target locks. */
export async function persistAssetMediaEvent(
  tx: Db,
  { siteId, target, event, actorId, requestId, fingerprint }: Persisted,
) {
  if (event.version === 1) {
    const isAsset = target.type === "asset";
    await tx
      .insert(targets)
      .values({
        siteId,
        targetType: target.type,
        assetId: isAsset ? target.id : null,
        modelId: isAsset ? null : target.id,
      })
      .onConflictDoNothing();
  }
  const [current] = await tx
    .update(targets)
    .set({ version: event.version })
    .where(and(targetMatches(siteId, target), eq(targets.version, event.version - 1)))
    .returning({ id: targets.id });
  if (current === undefined) invariant("Equipment media changed while its revision was locked");

  const targetId = current.id;
  await tx.insert(events).values({ ...event, siteId, targetId, actorId });
  await tx
    .insert(receipts)
    .values({ eventId: event.id, siteId, targetId, actorId, requestId, fingerprint });
}
