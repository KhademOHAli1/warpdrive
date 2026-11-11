import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { env } from "@/config/env";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { canonicalScopeJson } from "@/features/privacy/scopeDraftCanonical";
import {
  type NewsletterReceiptResult,
  type NewsletterReceiptState,
  newsletterOperationReceipts,
} from "./schema/operationReceipts";

const receipts = newsletterOperationReceipts;
const fingerprintKey = Buffer.from(
  hkdfSync(
    "sha256",
    Buffer.from(env.TOKEN_ENCRYPTION_KEY, "base64"),
    "warpdrive-newsletter",
    "operation-fingerprint-v1",
    32,
  ),
);

export type NewsletterReceiptKey = { actorId: string; operationId: string };

type Intent = NewsletterReceiptKey & {
  operation: string;
  intentFingerprint: Buffer;
};

type FinalReceipt =
  | { state: "succeeded"; result: NewsletterReceiptResult }
  | { state: "failed" | "unknown"; result: null };

export function newsletterIntent(
  key: NewsletterReceiptKey,
  operation: string,
  input: unknown,
): Intent {
  // The operation has already parsed a closed schema. Normalize the same JSON wire values the
  // engine sees, including omitted optional properties, before sorting object keys.
  const json: unknown = JSON.parse(JSON.stringify(input));
  return {
    ...key,
    operation,
    intentFingerprint: createHmac("sha256", fingerprintKey)
      .update(canonicalScopeJson([1, key.actorId, key.operationId, operation, json]))
      .digest(),
  };
}

function keyFilter(key: NewsletterReceiptKey) {
  return and(eq(receipts.actorId, key.actorId), eq(receipts.operationId, key.operationId));
}

export async function admitNewsletterReceipt(db: Db, intent: Intent) {
  const [inserted] = await db
    .insert(receipts)
    .values(intent)
    .onConflictDoNothing({ target: [receipts.actorId, receipts.operationId] })
    .returning({ operationId: receipts.operationId });
  if (inserted !== undefined) return { admitted: true } as const;

  // A separate statement at READ COMMITTED sees the winner after the unique index conflict
  // has resolved. The original actor, operation and payload must all agree before replay.
  const [existing] = await db.select().from(receipts).where(keyFilter(intent)).limit(1);
  if (
    existing === undefined ||
    existing.operation !== intent.operation ||
    existing.intentVersion !== 1 ||
    existing.intentFingerprint.length !== intent.intentFingerprint.length ||
    !timingSafeEqual(existing.intentFingerprint, intent.intentFingerprint)
  ) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "This operation ID is bound to different campaign input.",
    });
  }
  return { admitted: false, state: existing.state, result: existing.result } as const;
}

export async function finishNewsletterReceipt(
  db: Db,
  key: NewsletterReceiptKey,
  outcome: FinalReceipt,
): Promise<void> {
  // Finalization has its own bounded transaction. A caller disconnect after remote acceptance
  // cannot cancel the receipt. The pending row prevents takeover if this transaction fails.
  await db.transaction(async (tx) => {
    await tx.execute(sql`set local statement_timeout = '4s'`);
    await tx.execute(sql`set local lock_timeout = '1s'`);
    const [updated] = await tx
      .update(receipts)
      .set({ ...outcome, finishedAt: sql`clock_timestamp()` })
      .where(and(keyFilter(key), eq(receipts.state, "admitted"), isNull(receipts.reviewedAt)))
      .returning({ operationId: receipts.operationId });
    if (updated === undefined) {
      throw new AppError(ERROR_IDS.DB_INVARIANT, "Newsletter receipt finalization failed", {});
    }
  });
}

const entityResults = new Set([
  "campaigns.create",
  "campaigns.clone",
  "campaigns.update",
  "campaigns.status",
  "lists.create",
  "lists.update",
  "subscribers.create",
  "subscribers.update",
  "media.upload",
  "templates.create",
  "templates.update",
]);
const idProjection = z.object({ id: z.number().int().positive().safe() });
const updateProjection = z.object({ reloadDeferred: z.boolean(), unchanged: z.boolean() });
const cleanupProjection = z.object({ deleted: z.number().int().nonnegative().nullable() });

export function projectNewsletterReceipt(
  operation: string,
  result: unknown,
): NewsletterReceiptResult {
  if (entityResults.has(operation)) return idProjection.parse(result);
  if (operation === "admin.update") return updateProjection.parse(result);
  if (operation === "admin.cleanup") return cleanupProjection.parse(result);
  return { acknowledged: true };
}

export function replayNewsletterResult(
  state: NewsletterReceiptState,
  result: NewsletterReceiptResult | null,
): NewsletterReceiptResult | true {
  if (state === "failed") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "This operation was rejected before dispatch. Review the action before trying again.",
    });
  }
  if (state !== "succeeded" || result === null) throw newsletterUnconfirmed();
  return "acknowledged" in result ? true : result;
}

export function newsletterUnconfirmed(): TRPCError {
  return new TRPCError({
    code: "BAD_GATEWAY",
    message:
      "The campaign service could not confirm the result. Check the operation receipt before starting another action.",
  });
}

export const newsletterResolutionSchema = z.strictObject({
  outcome: z.enum(["applied", "notApplied"]),
  evidenceSource: z.enum(["engineRecord", "engineLog", "deliveryLog", "importStatus"]),
  evidenceReference: z
    .string()
    .trim()
    .max(36)
    .regex(
      /^(?:[1-9][0-9]{0,15}|[A-Z]{2,12}-[0-9]{1,16}|[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12})$/,
    ),
});
export type NewsletterReceiptResolution = z.infer<typeof newsletterResolutionSchema>;

function reviewableReceipt() {
  return and(
    isNull(receipts.reviewedAt),
    or(
      eq(receipts.state, "unknown"),
      and(
        eq(receipts.state, "admitted"),
        sql`${receipts.createdAt} < clock_timestamp() - interval '1 minute'`,
      ),
    ),
  );
}

export async function resolveNewsletterReceipt(
  db: Db,
  key: NewsletterReceiptKey,
  resolution: NewsletterReceiptResolution,
) {
  const [reviewed] = await db
    .update(receipts)
    .set({
      reviewedAt: sql`clock_timestamp()`,
      resolutionOutcome: resolution.outcome,
      evidenceSource: resolution.evidenceSource,
      evidenceReference: resolution.evidenceReference,
    })
    .where(and(keyFilter(key), reviewableReceipt()))
    .returning({ operationId: receipts.operationId });
  const receipt = await readNewsletterReceipt(db, key);
  if (reviewed !== undefined && receipt !== null) return { receipt, recorded: true };

  // An operator who loses the review response can safely submit the same attestation again.
  // A competing review cannot overwrite the original evidence or create another audit event.
  if (
    receipt !== null &&
    receipt.resolution?.outcome === resolution.outcome &&
    receipt.resolution.evidenceSource === resolution.evidenceSource &&
    receipt.resolution.evidenceReference === resolution.evidenceReference
  ) {
    return { receipt, recorded: false };
  }
  throw new TRPCError({
    code: "CONFLICT",
    message: "The operation is not available for reconciliation.",
  });
}

export async function readNewsletterReceipt(db: Db, key: NewsletterReceiptKey) {
  const [receipt] = await db
    .select({
      operationId: receipts.operationId,
      operation: receipts.operation,
      state: receipts.state,
      result: receipts.result,
      createdAt: receipts.createdAt,
      finishedAt: receipts.finishedAt,
      reviewAvailable: sql<boolean>`(${reviewableReceipt()})`,
      reviewedAt: receipts.reviewedAt,
      resolutionOutcome: receipts.resolutionOutcome,
      evidenceSource: receipts.evidenceSource,
      evidenceReference: receipts.evidenceReference,
    })
    .from(receipts)
    .where(keyFilter(key))
    .limit(1);
  if (!receipt) return null;
  const { reviewedAt, resolutionOutcome, evidenceSource, evidenceReference, ...projection } =
    receipt;
  const resolution =
    reviewedAt !== null &&
    resolutionOutcome !== null &&
    evidenceSource !== null &&
    evidenceReference !== null
      ? { outcome: resolutionOutcome, evidenceSource, evidenceReference, reviewedAt }
      : null;
  return { ...projection, resolution };
}

export type NewsletterReceiptView = NonNullable<Awaited<ReturnType<typeof readNewsletterReceipt>>>;
