import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { privacyCaseEvents, privacyCaseMembers, privacyCases } from "@/db/schema";
import { err, ok, type Result } from "@/types/result";
import {
  type PrivacyCaseSummary,
  privacyCaseSummary,
  privacyStorageOperation,
} from "./casePersistence";
import { privacyIntakeSchema } from "./caseSchemas";
import { encryptPrivacy, fingerprintPrivacy } from "./crypto";
import { type PrivacyActor, withPrivacyAuthority } from "./permissions";

type IntakeFailure = "invalid_input" | "forbidden" | "idempotency_conflict" | "storage_unavailable";
export async function createPrivacyCase(
  db: Db,
  actor: PrivacyActor,
  input: unknown,
  signal: AbortSignal,
): Promise<Result<PrivacyCaseSummary, IntakeFailure>> {
  const parsed = privacyIntakeSchema.safeParse(input);
  if (!parsed.success) return err("invalid_input");
  const body = JSON.stringify(parsed.data);
  const digest = fingerprintPrivacy(body, { caseId: actor.userId, purpose: "intake" });
  return privacyStorageOperation(signal, () =>
    withPrivacyAuthority(db, actor, { capability: "case.intake" }, signal, async (tx) => {
      const [existing] = await tx
        .select()
        .from(privacyCases)
        .where(
          and(
            eq(privacyCases.createdBy, actor.userId),
            eq(privacyCases.intakeKey, parsed.data.intakeKey),
          ),
        );
      signal.throwIfAborted();
      if (existing !== undefined)
        return existing.intakeDigest === digest
          ? ok({ ...privacyCaseSummary(existing), status: "received", version: 1 })
          : err("idempotency_conflict" as const);
      const id = randomUUID();
      const [created] = await tx
        .insert(privacyCases)
        .values({
          id,
          kind: parsed.data.kind,
          createdBy: actor.userId,
          intakeKey: parsed.data.intakeKey,
          intakeDigest: digest,
          metadataEnc: encryptPrivacy(body, { caseId: id, purpose: "intake" }),
        })
        .returning();
      signal.throwIfAborted();
      if (created === undefined) return err("storage_unavailable" as const);
      await tx
        .insert(privacyCaseMembers)
        .values({ caseId: id, userId: actor.userId, capabilities: ["case.intake"] });
      await tx.insert(privacyCaseEvents).values({
        caseId: id,
        caseVersion: 1,
        commandId: parsed.data.intakeKey,
        actorId: actor.userId,
        action: "received",
        toStatus: "received",
      });
      signal.throwIfAborted();
      return ok(privacyCaseSummary(created));
    }),
  );
}
