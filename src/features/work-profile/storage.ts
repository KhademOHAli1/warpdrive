import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { recordAudit } from "@/features/identity/audit";
import type { WorkCommand } from "./contracts";
import { fail } from "./errors";
import type { WorkActor } from "./policy";
import { recoverOperation } from "./recovery";
import { workOperations, workspaceWorkProfiles } from "./schema";
export function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export const fingerprint = (v: unknown) => createHash("sha256").update(canonical(v)).digest("hex");
export async function lockProfile(db: Db, signal: AbortSignal) {
  await db.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext('warpdrive-work-profile'),hashtext('workspace-v1'))`,
  );
  signal.throwIfAborted();
  await db.insert(workspaceWorkProfiles).values({ id: true }).onConflictDoNothing();
  const [row] = await db
    .select()
    .from(workspaceWorkProfiles)
    .where(eq(workspaceWorkProfiles.id, true))
    .for("update");
  signal.throwIfAborted();
  if (!row) fail("unavailable");
  return row;
}
export async function bumpRevision(db: Db, signal: AbortSignal) {
  const [row] = await db
    .update(workspaceWorkProfiles)
    .set({ revision: sql`${workspaceWorkProfiles.revision}+1`, updatedAt: new Date() })
    .where(eq(workspaceWorkProfiles.id, true))
    .returning();
  signal.throwIfAborted();
  if (!row) fail("unavailable");
  return row.revision;
}
export async function commandTransaction<T>(
  db: Db,
  actor: WorkActor,
  input: WorkCommand,
  signal: AbortSignal,
  run: (tx: Db) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await lockProfile(tx, signal);
    const digest = fingerprint(input);
    const [receipt] = await tx
      .select()
      .from(workOperations)
      .where(eq(workOperations.requestId, input.requestId));
    signal.throwIfAborted();
    if (receipt) {
      if (receipt.actorId !== actor.id || receipt.fingerprint !== digest) fail("replay_conflict");
      await recoverOperation(tx, actor, input.requestId, signal);
      return receipt.response as T;
    }
    const response = await run(tx);
    signal.throwIfAborted();
    await tx
      .insert(workOperations)
      .values({ requestId: input.requestId, actorId: actor.id, fingerprint: digest, response });
    signal.throwIfAborted();
    await recordAudit(
      tx,
      {
        actorId: actor.id,
        targetType: "settings",
        targetId: null,
        action: `work.${input.action}`,
        after: { operationId: input.requestId },
      },
      signal,
    );
    return response;
  });
}
