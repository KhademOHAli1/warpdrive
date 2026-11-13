import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { operationsIncidents, operationsTransitions } from "@/db/schema";
import type { projectOperationsCurrent } from "./projection";
import { operationsInvariant } from "./storage";

type Projection = ReturnType<typeof projectOperationsCurrent>;
type IncidentState = typeof operationsIncidents.$inferSelect.state;

/** The source row is already locked by the caller. A revision is allocated only
 * for a genuine persisted transition, never for repeated polling or replay.
 */
export async function recordOperationsIncident(
  tx: Db,
  projection: Projection,
  now: Date,
  signal: AbortSignal,
): Promise<string | null> {
  signal.throwIfAborted();
  const [open] = await tx
    .select()
    .from(operationsIncidents)
    .where(
      and(
        eq(operationsIncidents.sourceId, projection.sourceId),
        eq(operationsIncidents.observationKey, projection.observationKey),
        isNull(operationsIncidents.recoveredAt),
      ),
    )
    .for("update")
    .limit(1);
  signal.throwIfAborted();
  if (projection.state === "unchecked") return null;
  if (projection.state === "healthy") {
    if (!open) return null;
    const revision = open.revision + 1;
    await tx
      .update(operationsIncidents)
      .set({ revision, recoveredAt: now, updatedAt: now })
      .where(eq(operationsIncidents.id, open.id));
    const [transition] = await tx
      .insert(operationsTransitions)
      .values({
        incidentId: open.id,
        revision,
        kind: "recovered",
        state: "healthy",
        reason: "ok",
        recordedAt: now,
      })
      .returning({ id: operationsTransitions.id });
    if (!transition) operationsInvariant("Operations recovery transition unavailable");
    return transition.id;
  }
  const state: IncidentState = projection.state;
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ state, reason: projection.reason }))
    .digest("hex");
  if (open?.fingerprint === fingerprint) return null;
  const revision = (open?.revision ?? 0) + 1;
  let incidentId = open?.id;
  if (incidentId !== undefined)
    await tx
      .update(operationsIncidents)
      .set({ state, reason: projection.reason, fingerprint, revision, updatedAt: now })
      .where(eq(operationsIncidents.id, incidentId));
  else {
    const [incident] = await tx
      .insert(operationsIncidents)
      .values({
        sourceId: projection.sourceId,
        observationKey: projection.observationKey,
        state,
        reason: projection.reason,
        fingerprint,
        revision,
        openedAt: now,
        updatedAt: now,
      })
      .returning({ id: operationsIncidents.id });
    if (!incident) operationsInvariant("Operations incident unavailable");
    incidentId = incident.id;
  }
  const [transition] = await tx
    .insert(operationsTransitions)
    .values({
      incidentId,
      revision,
      kind: open ? "changed" : "opened",
      state,
      reason: projection.reason,
      recordedAt: now,
    })
    .returning({ id: operationsTransitions.id });
  if (!transition) operationsInvariant("Operations incident transition unavailable");
  signal.throwIfAborted();
  return transition.id;
}
