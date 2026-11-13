import { createHash } from "node:crypto";
import { and, asc, eq, gt, or } from "drizzle-orm";
import type { Db } from "@/db/client";
import { operationsCurrent, operationsReceipts, operationsSources } from "@/db/schema";
import { err, ok, type Result } from "@/types/result";
import {
  admitOperationsBatch,
  type OperationsAdmissionError,
  type OperationsObservation,
  type OperationsSourceBinding,
} from "./contracts";
import { applyOperationsCurrent } from "./current";
import { recordOperationsIncident } from "./incidents";
import { projectOperationsCurrent } from "./projection";
import { pruneOperationsSourceLocked } from "./retention";
import {
  lockedOperationsSource,
  type OperationsSourceRole,
  operationsInstallationId,
  operationsInvariant,
  operationsNow,
  operationsTransaction,
} from "./storage";

export type OperationsRecordError =
  | OperationsAdmissionError
  | "source_unavailable"
  | "generation_retired"
  | "source_scope_denied"
  | "identity_conflict"
  | "expired_or_out_of_order"
  | "storage_pressure";
export interface OperationsRecordReceipt {
  receiptId: string;
  replayed: boolean;
  appliedObservations: number;
  transitions: string[];
  admissionState: "ready" | "storage_pressure";
}
const allowedKinds: Record<OperationsSourceRole, readonly OperationsObservation["kind"][]> = {
  host_collector: ["component", "heartbeat", "observer", "deployment"],
  application_sampler: ["feature", "provider", "heartbeat", "queue", "observer"],
  recovery_verifier: ["recovery", "observer"],
};
const observerRoles: Record<OperationsSourceRole, readonly string[]> = {
  host_collector: ["host_collector"],
  application_sampler: ["queue_sampler", "feature_sampler"],
  recovery_verifier: ["recovery_verifier"],
};

/** Internal authenticated-enrollment caller only. No public HTTP ingestion endpoint exists.
 * Expired identities below durable high-water return unknown/rejected, never a replayed success.
 */
export async function recordOperationsBatch(
  db: Db,
  binding: OperationsSourceBinding,
  rawBody: string,
  signal: AbortSignal,
): Promise<Result<OperationsRecordReceipt, OperationsRecordError>> {
  return operationsTransaction(db, signal, async (tx, bounded) => {
    const source = await lockedOperationsSource(tx, binding, bounded);
    if (source === null || !source.active) return err("source_unavailable");
    if (source.currentGenerationId !== binding.generationId) return err("generation_retired");
    const now = await operationsNow(tx, bounded);
    const before = await pruneOperationsSourceLocked(tx, source.id, now, bounded);
    if (before.pressured) return err("storage_pressure");
    const admitted = admitOperationsBatch(rawBody, binding, now.getTime());
    if (!admitted.ok) return admitted;
    const { batch } = admitted.value;
    if (
      batch.observations.some(
        (observation) =>
          !allowedKinds[source.role].includes(observation.kind) ||
          (observation.kind === "observer" &&
            !observerRoles[source.role].includes(observation.observer)),
      )
    )
      return err("source_scope_denied");
    const payloadSha256 = createHash("sha256").update(JSON.stringify(batch)).digest("hex");
    const [existing] = await tx
      .select()
      .from(operationsReceipts)
      .where(
        and(
          eq(operationsReceipts.sourceId, source.id),
          eq(operationsReceipts.generationId, batch.generationId),
          eq(operationsReceipts.sequence, batch.sequence),
        ),
      )
      .limit(1);
    bounded.throwIfAborted();
    if (existing) {
      if (existing.payloadSha256 !== payloadSha256) return err("identity_conflict");
      return ok({
        receiptId: existing.id,
        replayed: true,
        appliedObservations: 0,
        transitions: [],
        admissionState: "ready",
      });
    }
    if (batch.sequence <= source.highestSequence) return err("expired_or_out_of_order");
    const ordinal = source.receiptOrdinal + 1;
    if (!Number.isSafeInteger(ordinal))
      operationsInvariant("Operations source receipt ordinal exhausted");
    const [receipt] = await tx
      .insert(operationsReceipts)
      .values({
        sourceId: source.id,
        generationId: batch.generationId,
        sequence: batch.sequence,
        ordinal,
        payloadSha256,
        payload: batch,
        observedAt: new Date(batch.observedAtMs),
        receivedAt: now,
        observationCount: batch.observations.length,
      })
      .returning({ id: operationsReceipts.id });
    if (!receipt) operationsInvariant("Operations event receipt unavailable");
    await tx
      .update(operationsSources)
      .set({ highestSequence: batch.sequence, receiptOrdinal: ordinal })
      .where(eq(operationsSources.id, source.id));
    const application = await applyOperationsCurrent(
      tx,
      { ...source, admissionState: "ready" },
      receipt.id,
      payloadSha256,
      batch,
      now,
      bounded,
    );
    const after = await pruneOperationsSourceLocked(tx, source.id, now, bounded);
    return ok({
      receiptId: receipt.id,
      replayed: false,
      ...application,
      admissionState: after.pressured ? "storage_pressure" : "ready",
    });
  });
}

export interface OperationsCurrentCursor {
  sourceId: string;
  observationKey: string;
}
const afterCurrent = (cursor: OperationsCurrentCursor | undefined) =>
  cursor
    ? or(
        gt(operationsCurrent.sourceId, cursor.sourceId),
        and(
          eq(operationsCurrent.sourceId, cursor.sourceId),
          gt(operationsCurrent.observationKey, cursor.observationKey),
        ),
      )
    : undefined;

/** Independently schedule this bounded pass; UI reads never write incidents or run
 * queue aggregates. Missing external scheduling remains a separate acceptance gate.
 */
export async function reconcileOperationsIncidents(
  db: Db,
  signal: AbortSignal,
  cursor?: OperationsCurrentCursor,
) {
  return operationsTransaction(db, signal, async (tx, bounded) => {
    const installationId = await operationsInstallationId(tx, bounded);
    if (installationId === null)
      return { checked: 0, transitions: [] as string[], nextCursor: null };
    const rows = await tx
      .select({
        sourceId: operationsCurrent.sourceId,
        observationKey: operationsCurrent.observationKey,
      })
      .from(operationsCurrent)
      .innerJoin(operationsSources, eq(operationsSources.id, operationsCurrent.sourceId))
      .where(and(eq(operationsSources.installationId, installationId), afterCurrent(cursor)))
      .orderBy(asc(operationsCurrent.sourceId), asc(operationsCurrent.observationKey))
      .limit(100);
    const transitions: string[] = [];
    const touchedSources = new Set<string>();
    for (const key of rows) {
      bounded.throwIfAborted();
      const [source] = await tx
        .select()
        .from(operationsSources)
        .where(
          and(
            eq(operationsSources.id, key.sourceId),
            eq(operationsSources.installationId, installationId),
          ),
        )
        .for("update")
        .limit(1);
      if (!source) continue;
      const [current] = await tx
        .select()
        .from(operationsCurrent)
        .where(
          and(
            eq(operationsCurrent.sourceId, key.sourceId),
            eq(operationsCurrent.observationKey, key.observationKey),
          ),
        )
        .limit(1);
      if (!current) continue;
      const now = await operationsNow(tx, bounded);
      const transition = await recordOperationsIncident(
        tx,
        projectOperationsCurrent(current, source, now),
        now,
        bounded,
      );
      if (transition !== null) transitions.push(transition);
      touchedSources.add(source.id);
    }
    for (const sourceId of touchedSources)
      await pruneOperationsSourceLocked(tx, sourceId, await operationsNow(tx, bounded), bounded);
    return {
      checked: rows.length,
      transitions,
      nextCursor: rows.length === 100 ? (rows.at(-1) ?? null) : null,
    };
  });
}

/** One source per pass, with bounded deletes and a stable source cursor. No old
 * generation is admitted after rotation; no deleted receipt can authorize replay.
 */
export async function pruneOperationsHistory(db: Db, signal: AbortSignal, afterSourceId?: string) {
  return operationsTransaction(db, signal, async (tx, bounded) => {
    const installationId = await operationsInstallationId(tx, bounded);
    if (installationId === null)
      return {
        sourceId: null,
        nextCursor: null,
        deletedReceipts: 0,
        deletedTransitions: 0,
        deletedIncidents: 0,
        pressured: false,
      };
    const [source] = await tx
      .select()
      .from(operationsSources)
      .where(
        and(
          eq(operationsSources.installationId, installationId),
          afterSourceId === undefined ? undefined : gt(operationsSources.id, afterSourceId),
        ),
      )
      .orderBy(asc(operationsSources.id))
      .for("update")
      .limit(1);
    if (!source)
      return {
        sourceId: null,
        nextCursor: null,
        deletedReceipts: 0,
        deletedTransitions: 0,
        deletedIncidents: 0,
        pressured: false,
      };
    const now = await operationsNow(tx, bounded);
    return {
      sourceId: source.id,
      nextCursor: source.id,
      ...(await pruneOperationsSourceLocked(tx, source.id, now, bounded)),
    };
  });
}
