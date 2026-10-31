import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { resolveWorkflowSession } from "@/features/auth/better/sessionPolicy";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { err, ok, type Result } from "@/types/result";
import { decryptToken, encryptToken } from "./crypto";
import { lockMailboxSession } from "./mailConnectionProofContext";
import type { MailboxActorSession } from "./mailConnectionSchemas";

export type GmailOAuthError =
  | "permission"
  | "fresh_auth_required"
  | "stale_state"
  | "revocation_pending"
  | "error";
export const hashGmailOAuthState = (state: string): string =>
  createHash("sha256").update("warpdrive:gmail-oauth-state:v1\0").update(state).digest("hex");
const envelopeSchema = z.strictObject({
  purpose: z.literal("gmail_oauth"),
  version: z.literal(1),
  actorId: z.uuid(),
  sessionId: z.uuid(),
  verifier: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});

// The outbox may still revoke a previous consent. Do not grant new credentials
// for that exact mailbox until the referenced revocation has finished.
export async function hasPendingGmailRevocation(
  db: DbOrTx,
  actorId: string,
  email: string,
  signal: AbortSignal,
): Promise<boolean> {
  const rows = await db.execute(sql`
    SELECT r.id FROM email_accounts a JOIN auth_integration_revocations r
      ON r.id::text=a.connection_settings->>'remoteRevocationId' AND r.user_id=a.user_id AND r.provider='google'
    WHERE a.user_id=${actorId} AND a.provider='gmail' AND a.email_address=${email.trim().toLowerCase()}
      AND r.status<>'revoked' LIMIT 1
  `);
  signal.throwIfAborted();
  return rows.rows.length > 0;
}

export async function resolveGmailOAuthSession(db: Db, headers: Headers, signal: AbortSignal) {
  const fresh = await resolveWorkflowSession(db, headers, signal, { requireFresh: true });
  if (fresh !== null) return ok(fresh);
  return err(
    (await resolveWorkflowSession(db, headers, signal)) === null
      ? ("permission" as const)
      : ("fresh_auth_required" as const),
  );
}

export async function createGmailOAuthState(
  db: Db,
  context: MailboxActorSession,
  signal: AbortSignal,
): Promise<Result<{ state: string; codeChallenge: string }, GmailOAuthError>> {
  signal.throwIfAborted();
  return db.transaction(async (tx) => {
    if (!(await lockMailboxSession(tx, context, signal))) return err("fresh_auth_required");
    const owner = (await tx.execute(sql`SELECT email FROM users WHERE id=${context.actorId}`))
      .rows[0] as { email: string };
    if (await hasPendingGmailRevocation(tx, context.actorId, owner.email, signal))
      return err("revocation_pending");
    const state = randomBytes(32).toString("hex");
    const verifier = randomBytes(32).toString("base64url");
    const envelope = { purpose: "gmail_oauth", version: 1, ...context, verifier };
    await tx.execute(sql`
      INSERT INTO mail_connection_checks(token_hash,user_id,session_id,payload_enc,expires_at)
      VALUES(${hashGmailOAuthState(state)},${context.actorId},${context.sessionId},${encryptToken(JSON.stringify(envelope))},now()+interval '10 minutes')
    `);
    signal.throwIfAborted();
    return ok({ state, codeChallenge: createHash("sha256").update(verifier).digest("base64url") });
  });
}

export async function consumeGmailOAuthState(
  db: Db,
  context: MailboxActorSession,
  query: string,
  cookie: string | undefined,
  signal: AbortSignal,
): Promise<Result<{ verifier: string }, GmailOAuthError>> {
  signal.throwIfAborted();
  if (
    !/^[a-f0-9]{64}$/.test(query) ||
    cookie === undefined ||
    !/^[a-f0-9]{64}$/.test(cookie) ||
    !timingSafeEqual(Buffer.from(query), Buffer.from(cookie))
  )
    return err("stale_state");
  return db.transaction(async (tx) => {
    if (!(await lockMailboxSession(tx, context, signal))) return err("fresh_auth_required");
    const owner = (await tx.execute(sql`SELECT email FROM users WHERE id=${context.actorId}`))
      .rows[0] as { email: string };
    if (await hasPendingGmailRevocation(tx, context.actorId, owner.email, signal))
      return err("revocation_pending");
    const row = (
      await tx.execute(sql`
      SELECT id,payload_enc FROM mail_connection_checks WHERE token_hash=${hashGmailOAuthState(query)}
        AND user_id=${context.actorId} AND session_id=${context.sessionId} AND consumed_at IS NULL AND expires_at>now()
      FOR UPDATE
    `)
    ).rows[0] as { id: string; payload_enc: Buffer | null } | undefined;
    if (row === undefined || row.payload_enc === null) return err("stale_state");
    const decrypted = decryptToken(row.payload_enc);
    if (!decrypted.ok) return err("stale_state");
    let envelope: z.infer<typeof envelopeSchema>;
    try {
      const parsed = envelopeSchema.safeParse(JSON.parse(decrypted.value));
      if (
        !parsed.success ||
        parsed.data.actorId !== context.actorId ||
        parsed.data.sessionId !== context.sessionId
      )
        return err("stale_state");
      envelope = parsed.data;
    } catch {
      return err("stale_state");
    }
    await tx.execute(
      sql`UPDATE mail_connection_checks SET payload_enc=NULL,consumed_at=now() WHERE id=${row.id}`,
    );
    signal.throwIfAborted();
    return ok({ verifier: envelope.verifier });
  });
}
