import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { privacyCaseEvents, privacyCases } from "@/db/schema";
import { lockAuthAccount } from "@/features/auth/better/accountLock";
import { lockMcpGrants } from "@/features/auth/management/mcpGrants";
import { err, ok, type Result } from "@/types/result";
import { currentPrivacySession, type PrivacyActor } from "./authoritySession";
import { privacyCaseSummary, privacyStorageOperation } from "./casePersistence";
import { privacyIntakeSchema } from "./caseSchemas";
import { encryptPrivacy, fingerprintPrivacy } from "./crypto";
import { identityTransaction } from "./identityTransaction";

const ownIntakeSchema = privacyIntakeSchema.pick({
  intakeKey: true,
  kind: true,
  locale: true,
  summary: true,
});
const ownStatusSchema = z.strictObject({ caseId: z.uuid() });

// An authenticated requester can manage its own request without acquiring reviewer authority.
// HTTP callers must first establish this internal actor through the native credential boundary.
async function withOwnSession<R extends Result<unknown, unknown>>(
  db: Db,
  actor: PrivacyActor,
  signal: AbortSignal,
  effect: (tx: Db) => Promise<R>,
) {
  return privacyStorageOperation(signal, () =>
    identityTransaction(db, signal, async (tx) => {
      await lockAuthAccount(tx, actor.userId, signal);
      await lockMcpGrants(tx, signal);
      if (!(await currentPrivacySession(tx, actor, signal))) return err("forbidden" as const);
      return effect(tx);
    }),
  );
}

export async function createOwnPrivacyCase(
  db: Db,
  actor: PrivacyActor,
  input: unknown,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const parsed = ownIntakeSchema.safeParse(input);
  if (!parsed.success) return err("invalid_input" as const);
  const intake = {
    ...parsed.data,
    subject: { kind: "user" as const, referenceId: actor.userId },
    recipient: { channel: "in_app" as const, userId: actor.userId },
  };
  const body = JSON.stringify(intake);
  const digest = fingerprintPrivacy(JSON.stringify({ operation: "own_intake", intake }), {
    caseId: actor.userId,
    purpose: "intake",
  });
  return withOwnSession(db, actor, signal, async (tx) => {
    const [existing] = await tx
      .select()
      .from(privacyCases)
      .where(
        and(eq(privacyCases.createdBy, actor.userId), eq(privacyCases.intakeKey, intake.intakeKey)),
      );
    signal.throwIfAborted();
    if (existing !== undefined)
      return existing.requesterUserId === actor.userId && existing.intakeDigest === digest
        ? ok({ ...privacyCaseSummary(existing), status: "received", version: 1 })
        : err("idempotency_conflict" as const);
    const id = randomUUID();
    const [created] = await tx
      .insert(privacyCases)
      .values({
        id,
        createdBy: actor.userId,
        requesterUserId: actor.userId,
        kind: intake.kind,
        intakeKey: intake.intakeKey,
        intakeDigest: digest,
        metadataEnc: encryptPrivacy(body, { caseId: id, purpose: "intake" }),
      })
      .returning();
    signal.throwIfAborted();
    if (created === undefined) return err("storage_unavailable" as const);
    await tx.insert(privacyCaseEvents).values({
      caseId: id,
      caseVersion: 1,
      commandId: intake.intakeKey,
      actorId: actor.userId,
      action: "received",
      toStatus: "received",
    });
    signal.throwIfAborted();
    return ok(privacyCaseSummary(created));
  });
}

export async function readOwnPrivacyCase(
  db: Db,
  actor: PrivacyActor,
  input: unknown,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const parsed = ownStatusSchema.safeParse(input);
  if (!parsed.success) return err("invalid_input" as const);
  return withOwnSession(db, actor, signal, async (tx) => {
    const [row] = await tx
      .select({
        id: privacyCases.id,
        kind: privacyCases.kind,
        status: privacyCases.status,
        version: privacyCases.version,
        receivedAt: privacyCases.receivedAt,
        dueAt: privacyCases.dueAt,
      })
      .from(privacyCases)
      .where(
        and(
          eq(privacyCases.id, parsed.data.caseId),
          eq(privacyCases.requesterUserId, actor.userId),
        ),
      );
    signal.throwIfAborted();
    return row === undefined ? err("not_found" as const) : ok(row);
  });
}
