import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { authUsers, persons, users } from "@/db/schema";
import { err, ok } from "@/types/result";
import { privacyStorageOperation } from "./casePersistence";
import { readIdentityCommand } from "./identityPersistence";
import {
  identityVerificationSchema,
  type ReviewedRecipient,
  type ReviewedSubject,
} from "./identitySchemas";
import { storeIdentityProof } from "./identityStore";
import { type PrivacyActor, withPrivacyAuthority } from "./permissions";

async function subjectExists(db: Db, subject: ReviewedSubject, signal: AbortSignal) {
  if (subject.kind === "external") return true;
  const table = subject.kind === "contact" ? persons : users;
  const [reference] = await db
    .select({ id: table.id })
    .from(table)
    .where(eq(table.id, subject.referenceId))
    .limit(1);
  signal.throwIfAborted();
  return reference !== undefined;
}

export async function identityRecipientExists(
  db: Db,
  recipient: ReviewedRecipient,
  signal: AbortSignal,
) {
  if (recipient.channel !== "in_app") return true;
  const [reference] = await db
    .select({ id: users.id })
    .from(users)
    .innerJoin(authUsers, eq(authUsers.id, users.id))
    .where(
      and(
        eq(users.id, recipient.userId),
        eq(users.isActive, true),
        isNull(users.invitedAt),
        eq(authUsers.emailVerified, true),
      ),
    )
    .limit(1);
  signal.throwIfAborted();
  return reference !== undefined;
}

export async function verifyPrivacyCaseIdentity(
  db: Db,
  actor: PrivacyActor,
  raw: unknown,
  signal: AbortSignal,
) {
  const parsed = identityVerificationSchema.safeParse(raw);
  if (!parsed.success || new Date(parsed.data.evidence.observedAt).getTime() > Date.now())
    return err("invalid_input" as const);
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
          "identity.verified",
          signal,
        );
        if (!current.ok) return current;
        if (current.value.replay !== null) return ok(current.value.replay);
        if (
          !(await subjectExists(tx, command.subject, signal)) ||
          !(await identityRecipientExists(tx, command.recipient, signal))
        )
          return err("forbidden" as const);
        return storeIdentityProof(
          tx,
          actor,
          current.value.row,
          command.commandId,
          current.value.digest,
          command.subject,
          command.recipient,
          { method: "operator_review", confirmation: command.evidence },
          "identity.verified",
          signal,
        );
      },
    ),
  );
}
