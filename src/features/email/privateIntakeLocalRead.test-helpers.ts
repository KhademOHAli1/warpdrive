import { eq, sql } from "drizzle-orm";
import { vi } from "vitest";
import type { Db } from "@/db/client";
import { emailThreadReads } from "@/db/schema/emailReads";
import { ok } from "@/types/result";
import type { ImapThreadOperationDeps } from "./imapThreadOperationsTypes";
import {
  heldSmtpDispatchFixture,
  privateDispatchRemoteSnapshot,
} from "./privateIntakeDispatchRestrictions.test-helpers";
import { hydrateOwner } from "./syncCursor";

export async function privateLocalReadFixture(db: Db, admin = false) {
  const f = await heldSmtpDispatchFixture(db);
  try {
    if (admin) await db.execute(sql`UPDATE users SET is_admin=true WHERE id=${f.owner.id}`);
    const owner = await hydrateOwner(db, f.owner.id, f.args.signal);
    if (!owner.ok) throw owner.error;
    const loadConnection = vi.fn<NonNullable<ImapThreadOperationDeps["loadConnection"]>>(() =>
      Promise.resolve(ok(f.runtime)),
    );
    const append = vi.spyOn(f.runtime.imap, "appendSent");
    return {
      ...f,
      actor: owner.value,
      loadConnection,
      append,
      async close() {
        append.mockRestore();
        await f.close();
      },
    };
  } catch (error) {
    await f.close();
    throw error;
  }
}

export type PrivateLocalReadFixture = Awaited<ReturnType<typeof privateLocalReadFixture>>;

export async function privateLocalReadRows(db: Db, f: PrivateLocalReadFixture) {
  const rows = await db
    .select({
      thread_id: emailThreadReads.threadId,
      user_id: emailThreadReads.userId,
      read_at: emailThreadReads.readAt,
      read_at_exact: sql<string>`${emailThreadReads.readAt}::text`,
    })
    .from(emailThreadReads)
    .where(eq(emailThreadReads.threadId, f.threadId))
    .orderBy(emailThreadReads.userId);
  f.args.signal.throwIfAborted();
  return rows;
}

// Read markers and sync bookkeeping are intentionally separate from immutable mail facts.
// Whole-row snapshots here are test oracles, not the versioned runtime hash contract.
export async function privateLocalReadFacts(db: Db, f: PrivateLocalReadFixture) {
  const result = await db.execute(sql`SELECT jsonb_build_object(
    'messages',(SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.id),'[]'::jsonb)
      FROM email_messages m WHERE m.account_id=${f.accountId}),
    'threads',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]'::jsonb)
      FROM email_threads t WHERE t.account_id=${f.accountId}),
    'intake',(SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY i.id),'[]'::jsonb)
      FROM email_private_intake i WHERE i.account_id=${f.accountId}),
    'reviews',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.intake_id,r.revision),'[]'::jsonb)
      FROM email_private_intake_reviews r WHERE r.account_id=${f.accountId}),
    'attachments',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]'::jsonb)
      FROM email_message_attachments a WHERE a.account_id=${f.accountId}),
    'attempts',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]'::jsonb)
      FROM email_send_attempts s WHERE s.account_id=${f.accountId}),
    'tracking',(SELECT coalesce(jsonb_agg(to_jsonb(k) ORDER BY k.id),'[]'::jsonb)
      FROM email_tracking_tokens k JOIN email_send_attempts s ON s.id=k.send_attempt_id
      WHERE s.account_id=${f.accountId}),
    'notifications',(SELECT coalesce(jsonb_agg(to_jsonb(n) ORDER BY n.id),'[]'::jsonb)
      FROM notifications n WHERE n.id=${f.notificationId})
    ) AS snapshot`);
  f.args.signal.throwIfAborted();
  return result.rows;
}

export async function privateLocalReadMailbox(db: Db, f: PrivateLocalReadFixture) {
  const facts = await privateLocalReadFacts(db, f);
  const bookkeeping = await db.execute(sql`SELECT
    (SELECT to_jsonb(a) FROM email_accounts a WHERE a.id=${f.accountId}) AS account,
    (SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.id),'[]'::jsonb)
      FROM mail_message_locators l WHERE l.account_id=${f.accountId}) AS locators,
    (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]'::jsonb)
      FROM mail_folders p WHERE p.account_id=${f.accountId}) AS folders`);
  f.args.signal.throwIfAborted();
  return { facts, bookkeeping: bookkeeping.rows };
}

export function privateLocalReadRemote(f: PrivateLocalReadFixture) {
  return {
    authentications: f.imap.authenticationAttempts(),
    commands: [...f.imap.state.commands],
    folders: privateDispatchRemoteSnapshot(f),
    submitted: f.smtp.received.map((source) => source.toString("base64")),
  };
}
