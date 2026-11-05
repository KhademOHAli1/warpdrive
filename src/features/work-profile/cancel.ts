import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { WorkCommand } from "./contracts";
import { fail } from "./errors";
import type { WorkActor } from "./policy";
import { recoverOperation } from "./recovery";
import { workOperations } from "./schema";
import { fingerprint } from "./storage";
/** Caller owns the same profile transaction lock used by every delayed original command. */
export async function cancelOperation(
  db: Db,
  actor: WorkActor,
  input: Extract<WorkCommand, { action: "cancel_operation" }>,
  signal: AbortSignal,
) {
  if (input.targetRequestId === input.requestId) fail("invalid_input");
  const [existing] = await db
    .select()
    .from(workOperations)
    .where(eq(workOperations.requestId, input.targetRequestId));
  signal.throwIfAborted();
  if (existing) {
    if (existing.actorId !== actor.id) fail("not_found");
    return recoverOperation(db, actor, input.targetRequestId, signal);
  }
  const response = { status: "canceled" as const, requestId: input.targetRequestId };
  await db.insert(workOperations).values({
    requestId: input.targetRequestId,
    actorId: actor.id,
    fingerprint: fingerprint({ actorId: actor.id, canceled: input.targetRequestId }),
    response,
  });
  signal.throwIfAborted();
  return response;
}
