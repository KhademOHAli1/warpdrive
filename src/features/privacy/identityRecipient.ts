import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { privacyCases, privacyCaseVerifications } from "@/db/schema";
import { err, ok } from "@/types/result";
import { privacyCaseSummary, privacyStorageOperation } from "./casePersistence";
import { encryptPrivacy } from "./crypto";
import {
  identityAttentionStatus,
  readIdentityCommand,
  recordIdentityEvent,
} from "./identityPersistence";
import { identityRecipientExists } from "./identityReview";
import { identityRecipientSchema } from "./identitySchemas";
import { identityRecipientDigest } from "./identityStore";
import { type PrivacyActor, withPrivacyAuthority } from "./permissions";

export async function changePrivacyCaseRecipient(
  db: Db,
  actor: PrivacyActor,
  raw: unknown,
  signal: AbortSignal,
) {
  const parsed = identityRecipientSchema.safeParse(raw);
  if (!parsed.success) return err("invalid_input" as const);
  const command = parsed.data;
  return privacyStorageOperation(signal, () =>
    withPrivacyAuthority(
      db,
      actor,
      { capability: "case.review", caseId: command.caseId },
      signal,
      async (tx) => {
        const current = await readIdentityCommand(
          tx,
          actor,
          command,
          command,
          "recipient.changed",
          signal,
        );
        if (!current.ok) return current;
        if (current.value.replay !== null) return ok(current.value.replay);
        if (!(await identityRecipientExists(tx, command.recipient, signal)))
          return err("forbidden" as const);
        const { row, digest } = current.value;
        const now = new Date();
        const recipientVersion = row.recipientVersion + 1;
        const verificationVersion = row.verificationVersion + 1;
        const pending = {
          recipientEnc: encryptPrivacy(JSON.stringify(command.recipient), {
            caseId: row.id,
            purpose: "identity",
          }),
          recipientDigest: identityRecipientDigest(command.recipient, row.id),
          evidenceEnc: null,
          method: null,
          verifiedBy: null,
          verifiedAt: null,
          scopeVersion: row.scopeVersion,
          recipientVersion,
          verificationVersion,
          revokedAt: now,
        };
        await tx
          .insert(privacyCaseVerifications)
          .values({ caseId: row.id, ...pending })
          .onConflictDoUpdate({ target: privacyCaseVerifications.caseId, set: pending });
        const [updated] = await tx
          .update(privacyCases)
          .set({
            recipientVersion,
            verificationVersion,
            verifiedAt: null,
            version: row.version + 1,
            status: identityAttentionStatus(row),
            updatedAt: now,
          })
          .where(eq(privacyCases.id, row.id))
          .returning();
        signal.throwIfAborted();
        if (updated === undefined) return err("storage_unavailable" as const);
        await recordIdentityEvent(
          tx,
          actor,
          row,
          updated,
          command.commandId,
          digest,
          "recipient.changed",
          {
            reason: command.reason,
            recipientDigest: pending.recipientDigest,
            recipientVersion,
            verificationVersion,
          },
          signal,
        );
        return ok(privacyCaseSummary(updated));
      },
    ),
  );
}
