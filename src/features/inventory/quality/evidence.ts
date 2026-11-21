import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { makeStorageClient, type StorageClient } from "@/features/files/storage";
import { err, ok, type Result } from "@/types/result";
import { withQualityTarget } from "./access";
import type {
  QualityCommand,
  QualityCommandResult,
  QualityError,
  QualityEvidenceInput,
} from "./contracts";
import {
  type EvidenceSeal,
  qualityEvidenceFile,
  readSealedQualityEvidence,
  removeUnusedEvidenceObject,
  sealQualityEvidenceUpload,
} from "./evidenceStorage";
import { QualityFailure } from "./failure";
import { inventoryQualityEvidence, inventoryQualityRunEvidence } from "./schema";

type Evidence = typeof inventoryQualityEvidence.$inferSelect;
type ReadyEvidence = Evidence & EvidenceSeal;
type RequestInput = Extract<QualityCommand, { type: "requestEvidence" }>;
type ConfirmInput = Extract<QualityCommand, { type: "confirmEvidence" }>;
type EvidenceResult<T> = Result<T, QualityError>;
type QualityEffect = Extract<QualityCommandResult, { ok: true }>["value"];

function isReady(row: Evidence): row is ReadyEvidence {
  return row.objectKey !== null && row.etag !== null && row.sha256 !== null;
}

function sameUpload(a: Evidence, b: Evidence) {
  return (
    a.stagingKey === b.stagingKey &&
    a.key === b.key &&
    a.contentType === b.contentType &&
    a.name === b.name &&
    a.sizeBytes === b.sizeBytes
  );
}

async function withEvidenceFailure<T>(operation: () => Promise<EvidenceResult<T>>) {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof QualityFailure) return err(error.code);
    throw error;
  }
}

async function readUploaderEvidence(
  tx: Db,
  { targetId, evidenceId }: Pick<ConfirmInput, "targetId" | "evidenceId">,
  userId: string,
) {
  const [row] = await tx
    .select()
    .from(inventoryQualityEvidence)
    .where(
      and(
        eq(inventoryQualityEvidence.id, evidenceId),
        eq(inventoryQualityEvidence.targetId, targetId),
        eq(inventoryQualityEvidence.uploaderId, userId),
      ),
    );
  return row;
}

export async function requestQualityEvidence(
  db: Db,
  who: NativeSessionRef,
  input: RequestInput,
  signal: AbortSignal,
  storage: StorageClient = makeStorageClient(),
): Promise<QualityCommandResult> {
  const file = qualityEvidenceFile(input.name, input.sizeBytes);
  if (file === null) return err("invalid");

  const evidenceId = randomUUID();
  const stagingKey = `inventory-quality-uploads/${input.targetId}/${evidenceId}`;
  const reserved = await withEvidenceFailure<undefined>(() =>
    withQualityTarget(
      db,
      who,
      input.targetId,
      "record",
      signal,
      async (tx, actor, target, plan) => {
        if (target.status === "passed") return err("state");
        if (!plan.steps.some((step) => step.key === input.key)) return err("invalid");
        await tx.insert(inventoryQualityEvidence).values({
          id: evidenceId,
          targetId: input.targetId,
          key: input.key,
          uploaderId: actor.id,
          ...file,
          sizeBytes: input.sizeBytes,
          stagingKey,
        });
        return ok(undefined);
      },
    ),
  );
  if (!reserved.ok) return reserved;

  const post = await storage.presignPost(stagingKey, file.contentType, signal, input.sizeBytes);
  if (!post.ok) return err("evidence");
  return withEvidenceFailure<QualityEffect>(() =>
    withQualityTarget(db, who, input.targetId, "record", signal, async (tx, actor, target) => {
      if (target.status === "passed") return err("state");
      const current = await readUploaderEvidence(
        tx,
        { targetId: input.targetId, evidenceId },
        actor.id,
      );
      return current?.stagingKey === stagingKey && current.objectKey === null
        ? ok({ evidenceId, post: post.value })
        : err("unavailable");
    }),
  );
}

function readConfirmation(db: Db, who: NativeSessionRef, input: ConfirmInput, signal: AbortSignal) {
  return withEvidenceFailure<Evidence>(() =>
    withQualityTarget(db, who, input.targetId, "read", signal, async (tx, actor, target) => {
      const row = await readUploaderEvidence(tx, input, actor.id);
      if (row === undefined) return err("unavailable");
      return isReady(row) || target.status !== "passed" ? ok(row) : err("state");
    }),
  );
}

async function commitEvidence(
  db: Db,
  who: NativeSessionRef,
  input: ConfirmInput,
  pending: Evidence,
  sealed: EvidenceSeal,
  signal: AbortSignal,
) {
  return withEvidenceFailure<boolean>(() =>
    withQualityTarget(
      db,
      who,
      input.targetId,
      "record",
      signal,
      async (tx, actor, target, plan) => {
        const current = await readUploaderEvidence(tx, input, actor.id);
        if (current === undefined) return err("unavailable");
        if (isReady(current)) return ok(false);
        if (target.status === "passed") return err("state");
        if (!sameUpload(current, pending) || !plan.steps.some((step) => step.key === current.key)) {
          return err("invalid");
        }
        await tx
          .update(inventoryQualityEvidence)
          .set(sealed)
          .where(eq(inventoryQualityEvidence.id, current.id));
        return ok(true);
      },
    ),
  );
}

export async function confirmQualityEvidence(
  db: Db,
  who: NativeSessionRef,
  input: ConfirmInput,
  signal: AbortSignal,
  storage: StorageClient = makeStorageClient(),
): Promise<QualityCommandResult> {
  const initial = await readConfirmation(db, who, input, signal);
  if (!initial.ok) return initial;
  const { evidenceId } = input;
  const pending = initial.value;
  if (isReady(pending)) return ok({ evidenceId });

  const sealed = await sealQualityEvidenceUpload(storage, pending, signal);
  if (!sealed.ok) {
    // Another confirmation may have removed staging after securing the same receipt.
    const latest = await readConfirmation(db, who, input, signal);
    if (!latest.ok) return latest;
    return isReady(latest.value) ? ok({ evidenceId }) : err("evidence");
  }
  // Delete only on a known commit outcome. An interrupted commit may have stored this key.
  const committed = await commitEvidence(db, who, input, pending, sealed.value, signal);
  if (committed.ok && committed.value) {
    await removeUnusedEvidenceObject(storage, pending.stagingKey);
  } else {
    await removeUnusedEvidenceObject(storage, sealed.value.objectKey);
    if (!committed.ok) {
      const latest = await readConfirmation(db, who, input, signal);
      if (!latest.ok || !isReady(latest.value)) return committed;
    }
  }
  return ok({ evidenceId });
}

async function linkedEvidence(
  db: Db,
  who: NativeSessionRef,
  { targetId, runId, evidenceId }: QualityEvidenceInput,
  signal: AbortSignal,
) {
  return withEvidenceFailure<ReadyEvidence>(() =>
    withQualityTarget(db, who, targetId, "read", signal, async (tx) => {
      const [row] = await tx
        .select({ evidence: inventoryQualityEvidence })
        .from(inventoryQualityRunEvidence)
        .innerJoin(
          inventoryQualityEvidence,
          and(
            eq(inventoryQualityEvidence.id, inventoryQualityRunEvidence.evidenceId),
            eq(inventoryQualityEvidence.targetId, inventoryQualityRunEvidence.targetId),
            eq(inventoryQualityEvidence.key, inventoryQualityRunEvidence.key),
          ),
        )
        .where(
          and(
            eq(inventoryQualityRunEvidence.targetId, targetId),
            eq(inventoryQualityRunEvidence.runId, runId),
            eq(inventoryQualityRunEvidence.evidenceId, evidenceId),
          ),
        );
      if (row === undefined || !isReady(row.evidence)) return err("unavailable");
      return ok(row.evidence);
    }),
  );
}

export async function readQualityEvidence(
  db: Db,
  who: NativeSessionRef,
  input: QualityEvidenceInput,
  signal: AbortSignal,
  storage: StorageClient = makeStorageClient(),
): Promise<EvidenceResult<{ name: string; bytes: Uint8Array }>> {
  const initial = await linkedEvidence(db, who, input, signal);
  if (!initial.ok) return initial;
  const row = initial.value;
  const loaded = await readSealedQualityEvidence(storage, row, signal);
  if (!loaded.ok) return loaded;

  const current = await linkedEvidence(db, who, input, signal);
  if (
    !current.ok ||
    current.value.objectKey !== row.objectKey ||
    current.value.sha256 !== row.sha256 ||
    current.value.etag !== row.etag
  ) {
    return err("unavailable");
  }
  return ok({ name: row.name, bytes: loaded.value });
}
