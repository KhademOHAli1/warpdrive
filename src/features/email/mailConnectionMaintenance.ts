import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";

// The shared ledger contains IMAP credentials or a Gmail PKCE verifier. Both
// purposes have the same retention rule; deleting a proof removes its ciphertext.
export async function pruneMailboxProofs(db: Db, signal: AbortSignal): Promise<number> {
  signal.throwIfAborted();
  return db.transaction(async (tx) => {
    const deleted = await tx.execute(sql`
      DELETE FROM mail_connection_checks proof WHERE proof.expires_at<=now() OR proof.consumed_at IS NOT NULL
        OR NOT EXISTS (SELECT 1 FROM users owner JOIN sessions session ON session.user_id=owner.id
          WHERE owner.id=proof.user_id AND session.id=proof.session_id
            AND owner.is_active AND owner.invited_at IS NULL
            AND session.revoked_at IS NULL AND session.expires_at>now())
      RETURNING proof.id
    `);
    signal.throwIfAborted();
    return deleted.rows.length;
  });
}
