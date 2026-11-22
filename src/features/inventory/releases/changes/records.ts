import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { HydratedActor } from "@/server/hydrateActor";
import type { ChangeReview, EngineeringChangeCommand, EngineeringChangeEvent } from "./contracts";
import { failEngineering } from "./errors";
import {
  inventoryEngineeringChanges as changes,
  type EngineeringChangeRow,
  inventoryEngineeringEvents as events,
  inventoryEngineeringRequests as requests,
} from "./schema";

export async function readEngineeringTime(tx: Db) {
  const result = await tx.execute<{ now_ms: number }>(
    sql`SELECT extract(epoch FROM clock_timestamp())::double precision * 1000 AS now_ms`,
  );
  const time = result.rows[0]?.now_ms;
  if (time === undefined) failEngineering("temporary");
  return new Date(time);
}

export async function requireEngineeringChange(tx: Db, itemId: string, changeId: string) {
  const [entry] = await tx
    .select()
    .from(changes)
    .where(and(eq(changes.itemId, itemId), eq(changes.id, changeId)));
  if (entry === undefined) failEngineering("unavailable");
  return entry;
}

function engineeringRequestFingerprint(command: EngineeringChangeCommand) {
  return createHash("sha256").update(JSON.stringify(command)).digest("hex");
}

export async function findEngineeringReceipt(
  tx: Db,
  actor: HydratedActor,
  command: EngineeringChangeCommand,
) {
  const [stored] = await tx
    .select()
    .from(requests)
    .where(and(eq(requests.actorId, actor.id), eq(requests.requestId, command.requestId)));
  if (stored === undefined) return null;
  if (
    stored.itemId !== command.itemId ||
    stored.fingerprint !== engineeringRequestFingerprint(command)
  )
    failEngineering("conflict");
  return stored;
}

export async function storeEngineeringReceipt(
  tx: Db,
  actor: HydratedActor,
  command: EngineeringChangeCommand,
  changeId: string,
) {
  const [stored] = await tx
    .insert(requests)
    .values({
      actorId: actor.id,
      requestId: command.requestId,
      itemId: command.itemId,
      changeId,
      fingerprint: engineeringRequestFingerprint(command),
    })
    .onConflictDoNothing()
    .returning({ changeId: requests.changeId });
  if (stored === undefined) failEngineering("conflict");
}

export async function recordEngineeringEvent(
  tx: Db,
  actor: HydratedActor,
  change: EngineeringChangeRow,
  event: { type: EngineeringChangeEvent["type"]; note?: string; review?: ChangeReview },
) {
  await tx.insert(events).values({
    changeId: change.id,
    version: change.version,
    actorId: actor.id,
    actorName: actor.name,
    type: event.type,
    note: event.note,
    review: event.review,
    createdAt: change.updatedAt,
  });
}

export async function advanceEngineeringChange(
  tx: Db,
  current: EngineeringChangeRow,
  change: Pick<
    Partial<EngineeringChangeRow>,
    "status" | "review" | "fingerprint" | "reason" | "effectiveAt" | "approvedAt" | "approvedBy"
  >,
  at: Date,
) {
  const [updated] = await tx
    .update(changes)
    .set({ ...change, version: current.version + 1, updatedAt: at })
    .where(
      and(
        eq(changes.id, current.id),
        eq(changes.itemId, current.itemId),
        eq(changes.version, current.version),
      ),
    )
    .returning();
  if (updated === undefined) failEngineering("conflict");
  return updated;
}
