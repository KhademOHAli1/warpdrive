import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { fail } from "./errors";
import { allowed, managesProfile, visible, type WorkActor } from "./policy";
import { workItems, workOperations } from "./schema";

function canceledRequestId(data: unknown) {
  if (
    data !== null &&
    typeof data === "object" &&
    "status" in data &&
    data.status === "canceled" &&
    "requestId" in data &&
    typeof data.requestId === "string"
  )
    return data.requestId;
  return null;
}

function completedData(response: unknown) {
  let data = response;
  for (
    let depth = 0;
    depth < 10 &&
    data !== null &&
    typeof data === "object" &&
    "status" in data &&
    data.status === "complete" &&
    "data" in data;
    depth++
  )
    data = data.data;
  if (data === null || typeof data !== "object") fail("unavailable");
  return data;
}

async function authorizeItemReceipt(db: Db, actor: WorkActor, id: string, signal: AbortSignal) {
  if (
    !allowed(actor, "work.view") &&
    !allowed(actor, "work.create") &&
    !allowed(actor, "work.change")
  )
    fail("forbidden");
  const [item] = await db.select().from(workItems).where(eq(workItems.id, id));
  signal.throwIfAborted();
  if (!item || !visible(actor, item)) fail("not_found");
}

async function authorizeReceipt(db: Db, actor: WorkActor, data: object, signal: AbortSignal) {
  if ("typeId" in data && "id" in data && typeof data.id === "string") {
    await authorizeItemReceipt(db, actor, data.id, signal);
  } else if ("installation" in data) {
    if (actor.type !== "admin") fail("forbidden");
  } else if ("preferences" in data) {
    if (!managesProfile(actor)) fail("forbidden");
  } else if (!allowed(actor, "work.manage")) fail("forbidden");
}

export async function recoverOperation(
  db: Db,
  actor: WorkActor,
  requestId: string,
  signal: AbortSignal,
) {
  const [operation] = await db
    .select()
    .from(workOperations)
    .where(and(eq(workOperations.requestId, requestId), eq(workOperations.actorId, actor.id)));
  signal.throwIfAborted();
  if (!operation || !actor.isActive) fail("not_found");
  const canceled = canceledRequestId(operation.response);
  if (canceled !== null) return { status: "canceled" as const, requestId: canceled };
  const data = completedData(operation.response);
  await authorizeReceipt(db, actor, data, signal);
  return { status: "complete" as const, data };
}
