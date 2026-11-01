import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { privacyCases, privacyCaseVerifications } from "@/db/schema";
import { lockAuthAccount } from "@/features/auth/better/accountLock";
import { lockMcpGrants } from "@/features/auth/management/mcpGrants";
import { err, ok } from "@/types/result";
import { currentPrivacySession, type PrivacyActor } from "./authoritySession";
import { privacyStorageOperation } from "./casePersistence";
import { privacyIntakeSchema } from "./caseSchemas";
import { decodeIdentity, readIdentityCommand, readIdentityIntake } from "./identityPersistence";
import { identityCommandSchema } from "./identitySchemas";
import { storeIdentityProof } from "./identityStore";
import { identityTransaction } from "./identityTransaction";

export async function verifyOwnPrivacyIdentity(
  db: Db,
  actor: PrivacyActor,
  raw: unknown,
  signal: AbortSignal,
) {
  const parsed = identityCommandSchema.safeParse(raw);
  if (!parsed.success) return err("invalid_input" as const);
  const command = parsed.data;
  return privacyStorageOperation(signal, () =>
    identityTransaction(db, signal, async (tx) => {
      await lockAuthAccount(tx, actor.userId, signal);
      await lockMcpGrants(tx, signal);
      if (!(await currentPrivacySession(tx, actor, signal))) return err("forbidden" as const);
      // Lock only an owned request before a version, status or receipt can reveal its existence.
      const [owned] = await tx
        .select({ id: privacyCases.id })
        .from(privacyCases)
        .where(
          and(eq(privacyCases.id, command.caseId), eq(privacyCases.requesterUserId, actor.userId)),
        )
        .for("no key update");
      signal.throwIfAborted();
      if (owned === undefined) return err("forbidden" as const);
      const current = await readIdentityCommand(
        tx,
        actor,
        command,
        command,
        "identity.self_verified",
        signal,
      );
      if (!current.ok) return current;
      const { row, digest } = current.value;
      if (row.requesterUserId !== actor.userId) return err("forbidden" as const);
      const intake = readIdentityIntake(row);
      if (!intake.ok) return intake;
      const { subject, recipient } = intake.value;
      if (
        subject.kind !== "user" ||
        subject.referenceId !== actor.userId ||
        recipient.channel !== "in_app" ||
        recipient.userId !== actor.userId
      )
        return err("forbidden" as const);
      const [binding] = await tx
        .select()
        .from(privacyCaseVerifications)
        .where(eq(privacyCaseVerifications.caseId, row.id));
      signal.throwIfAborted();
      if (binding !== undefined) {
        const selectedRecipient = decodeIdentity(
          binding.recipientEnc,
          privacyIntakeSchema.shape.recipient,
          row.id,
        );
        const selectedSubject =
          binding.subjectEnc === null
            ? ok(subject)
            : decodeIdentity(binding.subjectEnc, privacyIntakeSchema.shape.subject, row.id);
        if (
          !selectedRecipient.ok ||
          !selectedSubject.ok ||
          selectedRecipient.value.channel !== "in_app" ||
          selectedRecipient.value.userId !== actor.userId ||
          selectedSubject.value.kind !== "user" ||
          selectedSubject.value.referenceId !== actor.userId
        )
          return err("forbidden" as const);
      }
      if (current.value.replay !== null) return ok(current.value.replay);
      return storeIdentityProof(
        tx,
        actor,
        row,
        command.commandId,
        digest,
        subject,
        recipient,
        {
          method: "authenticated_self",
          userId: actor.userId,
          sessionId: actor.sessionId,
          observedAt: new Date().toISOString(),
        },
        "identity.self_verified",
        signal,
      );
    }),
  );
}
