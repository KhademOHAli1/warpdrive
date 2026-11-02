import { createHash, timingSafeEqual } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { dealCreateOperations } from "@/db/schema";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import {
  type CurrentNativeActor,
  currentNativeActor,
  type NativeSessionRef,
} from "@/features/auth/currentNativeActor";
import { type CreateDealSession, createDeal } from "./dealActions";
import { readNativeCreatedDeal } from "./nativeCreatedRead";
import { protectNativeCreationInputs } from "./nativeCreateInputs";
import {
  type NativeDealCreateEnvelopeV1,
  nativeDealCreateEnvelopeV1,
  nativeDealFingerprintBytesV1,
} from "./nativeCreateIntentV1";
import type { NativeDealCreateFailure, NativeDealCreateResult } from "./nativeCreateTypes";
import { dealCreateInput } from "./schemas";

class CreationRollback extends AppError {
  constructor(readonly result: NativeDealCreateFailure) {
    super(ERROR_IDS.DB_WRITE_FAILED, "Native creation rolled back");
  }
}
function failure(
  id: string,
  outcome: NativeDealCreateFailure["outcome"] = "unresolved",
): NativeDealCreateFailure {
  return { ok: false, error: { id }, outcome };
}
function sameFingerprint(receipt: typeof dealCreateOperations.$inferSelect, fingerprint: Buffer) {
  return (
    receipt.intentVersion === 1 &&
    receipt.intentFingerprint.length === fingerprint.length &&
    timingSafeEqual(receipt.intentFingerprint, fingerprint)
  );
}
function sessionFor(current: CurrentNativeActor): CreateDealSession {
  const actor = current.actor;
  return {
    userId: actor.id,
    isAdmin: actor.type === "admin",
    isActive: actor.isActive,
    sessionLive: true,
    flags: Object.fromEntries([...actor.flags].map((flag) => [flag, true])),
    visibilityGroupIds: [...actor.groupIds],
    managedUserIds: [...(actor.managedUserIds ?? [])],
    primaryVisibilityGroupId: current.primaryVisibilityGroupId,
  };
}
function sameSet(a: ReadonlySet<string> | undefined, b: ReadonlySet<string> | undefined) {
  return (
    (a?.size ?? 0) === (b?.size ?? 0) && [...(a ?? [])].every((value) => b?.has(value) === true)
  );
}
function sameActor(a: CurrentNativeActor, b: CurrentNativeActor) {
  return (
    a.actor.id === b.actor.id &&
    a.actor.type === b.actor.type &&
    a.actor.isActive === b.actor.isActive &&
    a.primaryVisibilityGroupId === b.primaryVisibilityGroupId &&
    sameSet(a.actor.flags, b.actor.flags) &&
    sameSet(a.actor.groupIds, b.actor.groupIds) &&
    sameSet(a.actor.managedUserIds, b.actor.managedUserIds)
  );
}

async function finishNativeCreationRead(
  tx: Db,
  who: NativeSessionRef,
  current: CurrentNativeActor,
  input: NativeDealCreateEnvelopeV1,
  fingerprint: Buffer,
  dealId: string | null,
  newlyCreated: boolean,
  signal: AbortSignal,
): Promise<NativeDealCreateResult> {
  const result = await readNativeCreatedDeal(tx, sessionFor(current), dealId, signal);
  if (result.moved) return failure(ERROR_IDS.DEAL_PRECONDITION);
  // Reread linkage only AFTER the result's pipeline/deal locks. A hard delete
  // can null the FK and a separate writer can reuse the old UUID while we wait.
  // Do not attach this operation to that independently restored/reused row.
  const [currentReceipt] = await tx
    .select()
    .from(dealCreateOperations)
    .where(
      and(
        eq(dealCreateOperations.actorId, current.actor.id),
        eq(dealCreateOperations.operationId, input.creationOperationId),
      ),
    );
  if (currentReceipt === undefined || !sameFingerprint(currentReceipt, fingerprint))
    return failure(ERROR_IDS.DEAL_CREATE_OPERATION_CONFLICT);
  const visibleDeal = currentReceipt.dealId === dealId ? result.deal : null;
  const finalActor = await currentNativeActor(tx, who, signal);
  if (finalActor === null || !sameActor(current, finalActor))
    return failure(ERROR_IDS.AUTH_SESSION_DEAD, newlyCreated ? "not_created" : "unresolved");
  signal.throwIfAborted();
  return { ok: true, deal: visibleDeal, replayed: true };
}

// Only the native server action supplies this credential-established internal reference.
// Unknown driver/commit failures propagate: the client must retain the same operation.
export async function createNativeDeal(
  db: Db,
  who: NativeSessionRef,
  raw: unknown,
  signal: AbortSignal,
): Promise<NativeDealCreateResult> {
  const parsed = nativeDealCreateEnvelopeV1.safeParse(raw);
  if (!parsed.success) return failure(ERROR_IDS.DEAL_CREATE_INPUT_INVALID);
  const input = parsed.data;
  if (input.expectedActorId !== who.userId.toLowerCase())
    return failure(ERROR_IDS.AUTH_SESSION_DEAD);
  const fingerprint = createHash("sha256").update(nativeDealFingerprintBytesV1(input)).digest();
  try {
    return await withCurrentAuthority(db, "read", signal, async (tx) => {
      if ((await currentNativeActor(tx, who, signal)) === null)
        return failure(ERROR_IDS.AUTH_SESSION_DEAD);
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`warpdrive.native.deal-create.v1:${input.expectedActorId}:${input.creationOperationId}`}, 0))`,
      );
      const current = await currentNativeActor(tx, who, signal);
      if (current === null) return failure(ERROR_IDS.AUTH_SESSION_DEAD);
      const session = sessionFor(current);
      // Plain receipt read, without a row lock; operation serialization owns this native key.
      const [receipt] = await tx
        .select()
        .from(dealCreateOperations)
        .where(
          and(
            eq(dealCreateOperations.actorId, current.actor.id),
            eq(dealCreateOperations.operationId, input.creationOperationId),
          ),
        );
      if (receipt !== undefined && !sameFingerprint(receipt, fingerprint))
        return failure(ERROR_IDS.DEAL_CREATE_OPERATION_CONFLICT);
      let dealId = receipt?.dealId ?? null;
      if (receipt === undefined) {
        const admitted = dealCreateInput.safeParse(input.deal);
        if (!admitted.success)
          throw new CreationRollback(failure(ERROR_IDS.DEAL_CREATE_INPUT_INVALID, "not_created"));
        const protectedInputs = await protectNativeCreationInputs(tx, session, input.deal, signal);
        if (!protectedInputs.ok)
          throw new CreationRollback(failure(protectedInputs.error.id, "not_created"));
        // Pass the real outer tx: nested savepoints, labels and transactional events stay atomic.
        const created = await createDeal(tx, session, admitted.data, signal);
        if (!created.ok) throw new CreationRollback(failure(created.error.id, "not_created"));
        dealId = created.value.id;
        await tx.insert(dealCreateOperations).values({
          actorId: current.actor.id,
          operationId: input.creationOperationId,
          intentVersion: 1,
          intentFingerprint: fingerprint,
          dealId,
        });
      }
      const completion = await finishNativeCreationRead(
        tx,
        who,
        current,
        input,
        fingerprint,
        dealId,
        receipt === undefined,
        signal,
      );
      if (!completion.ok) throw new CreationRollback(completion);
      return { ...completion, replayed: receipt !== undefined };
    });
  } catch (error) {
    if (error instanceof CreationRollback) return error.result;
    throw error;
  }
}

// Read-only recovery for an already acknowledged operation. Missing receipts and
// authorization errors never fall through to creation or release a retained known key.
export async function readNativeDealCreation(
  db: Db,
  who: NativeSessionRef,
  raw: unknown,
  signal: AbortSignal,
): Promise<NativeDealCreateResult> {
  const parsed = nativeDealCreateEnvelopeV1.safeParse(raw);
  if (!parsed.success) return failure(ERROR_IDS.DEAL_CREATE_INPUT_INVALID);
  const input = parsed.data;
  if (input.expectedActorId !== who.userId.toLowerCase())
    return failure(ERROR_IDS.AUTH_SESSION_DEAD);
  const fingerprint = createHash("sha256").update(nativeDealFingerprintBytesV1(input)).digest();
  return withCurrentAuthority(db, "read", signal, async (tx) => {
    const current = await currentNativeActor(tx, who, signal);
    if (current === null) return failure(ERROR_IDS.AUTH_SESSION_DEAD);
    const [receipt] = await tx
      .select()
      .from(dealCreateOperations)
      .where(
        and(
          eq(dealCreateOperations.actorId, current.actor.id),
          eq(dealCreateOperations.operationId, input.creationOperationId),
        ),
      );
    if (receipt === undefined) return failure(ERROR_IDS.DEAL_NOT_FOUND);
    if (!sameFingerprint(receipt, fingerprint))
      return failure(ERROR_IDS.DEAL_CREATE_OPERATION_CONFLICT);
    return finishNativeCreationRead(
      tx,
      who,
      current,
      input,
      fingerprint,
      receipt.dealId,
      false,
      signal,
    );
  });
}
