import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { MAILBOX_PROOF_VALIDITY_SECONDS } from "@/constants/mailConnections";
import type { Db } from "@/db/client";
import { err, ok } from "@/types/result";
import type { MailboxConnectionResult } from "./connections/types";
import { encryptToken } from "./crypto";
import { hashMailboxProof, lockMailboxSession } from "./mailConnectionProofContext";
import {
  type CheckedMailbox,
  checkedMailboxSchema,
  type MailboxActorSession,
} from "./mailConnectionSchemas";

export async function createMailboxProof(
  db: Db,
  context: MailboxActorSession,
  checked: CheckedMailbox,
  signal: AbortSignal,
): Promise<MailboxConnectionResult<{ checkId: string }>> {
  const parsed = checkedMailboxSchema.safeParse(checked);
  if (!parsed.success) return err("invalid_input");
  return db.transaction(async (tx) => {
    if (!(await lockMailboxSession(tx, context, signal))) return err("permission");
    await tx.execute(sql`DELETE FROM mail_connection_checks WHERE expires_at<=now()`);
    const checkId = randomBytes(32).toString("hex");
    const envelope = { version: 1, ...context, checked: parsed.data };
    await tx.execute(sql`
      INSERT INTO mail_connection_checks (token_hash, user_id, session_id, payload_enc, expires_at)
      VALUES (${hashMailboxProof(checkId)}, ${context.actorId}, ${context.sessionId},
        ${encryptToken(JSON.stringify(envelope))}, now()+${MAILBOX_PROOF_VALIDITY_SECONDS}*interval '1 second')
    `);
    signal.throwIfAborted();
    return ok({ checkId });
  });
}

export { commitMailboxProof } from "./mailConnectionCommit";
