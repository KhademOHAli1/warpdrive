import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { privacyCaseEvents, privacyCases } from "@/db/schema";
import { err, ok, type Result } from "@/types/result";
import type { PrivacyActor } from "./authoritySession";
import { privacyCaseSummary } from "./casePersistence";
import { privacyIntakeSchema } from "./caseSchemas";
import { decryptPrivacy, encryptPrivacy, fingerprintPrivacy } from "./crypto";

export type IdentityCase = typeof privacyCases.$inferSelect;
export type IdentityFailure =
  | "invalid_input"
  | "forbidden"
  | "stale_version"
  | "idempotency_conflict"
  | "evidence_unavailable"
  | "case_not_mutable"
  | "storage_unavailable";
export interface IdentityCommand {
  caseId: string;
  expectedVersion: number;
  commandId: string;
}

export function decodeIdentity<S extends z.ZodType>(
  packed: Buffer,
  schema: S,
  caseId: string,
  purpose: "identity" | "intake" = "identity",
): Result<z.infer<S>, "evidence_unavailable"> {
  const clear = decryptPrivacy(packed, { caseId, purpose });
  if (!clear.ok) return err("evidence_unavailable");
  try {
    const parsed = schema.safeParse(JSON.parse(clear.value));
    return parsed.success ? ok(parsed.data) : err("evidence_unavailable");
  } catch {
    return err("evidence_unavailable");
  }
}

export function readIdentityIntake(row: IdentityCase) {
  return decodeIdentity(row.metadataEnc, privacyIntakeSchema, row.id, "intake");
}

const receiptSchema = z.strictObject({ digest: z.string(), receipt: z.unknown() });
export async function readIdentityCommand(
  db: Db,
  actor: PrivacyActor,
  command: IdentityCommand,
  body: unknown,
  action: string,
  signal: AbortSignal,
) {
  const [row] = await db
    .select()
    .from(privacyCases)
    .where(eq(privacyCases.id, command.caseId))
    .for("no key update");
  signal.throwIfAborted();
  if (row === undefined) return err("forbidden" as const);
  const digest = fingerprintPrivacy(JSON.stringify({ action, body }), {
    caseId: row.id,
    purpose: "identity",
  });
  const [event] = await db
    .select()
    .from(privacyCaseEvents)
    .where(
      and(eq(privacyCaseEvents.caseId, row.id), eq(privacyCaseEvents.commandId, command.commandId)),
    );
  signal.throwIfAborted();
  if (event !== undefined) {
    const prior =
      event.detailEnc === null ? null : decodeIdentity(event.detailEnc, receiptSchema, row.id);
    if (
      prior === null ||
      !prior.ok ||
      prior.value.digest !== digest ||
      event.action !== action ||
      event.actorId !== actor.userId
    )
      return err("idempotency_conflict" as const);
    return ok({
      row,
      digest,
      replay: { ...privacyCaseSummary(row), version: event.caseVersion, status: event.toStatus },
    });
  }
  if (row.version !== command.expectedVersion) return err("stale_version" as const);
  if (row.status === "closed" || row.status === "cancelled")
    return err("case_not_mutable" as const);
  return ok({ row, digest, replay: null });
}

export async function recordIdentityEvent(
  db: Db,
  actor: PrivacyActor,
  prior: IdentityCase,
  updated: IdentityCase,
  commandId: string,
  digest: string,
  action: string,
  receipt: unknown,
  signal: AbortSignal,
) {
  await db.insert(privacyCaseEvents).values({
    caseId: prior.id,
    caseVersion: updated.version,
    commandId,
    actorId: actor.userId,
    action,
    fromStatus: prior.status,
    toStatus: updated.status,
    detailEnc: encryptPrivacy(JSON.stringify({ digest, receipt }), {
      caseId: prior.id,
      purpose: "identity",
    }),
  });
  signal.throwIfAborted();
}

export function identityAttentionStatus(row: IdentityCase) {
  return ["action_approved", "running", "response_ready", "responded"].includes(row.status)
    ? "needs_attention"
    : row.status;
}
