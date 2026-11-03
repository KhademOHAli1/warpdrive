import { expect, it } from "vitest";
import { seedUser } from "@/db/testing/factories";
import { getThread } from "@/features/email/emailReads";
import type { TestDb } from "@/test/db";
import { applyMigrations } from "./migrate";
import {
  freshMigrationDb,
  installPrefix,
  ledger,
  migrationFolder,
} from "./migrationAdmission.test-helpers";

const tables = [
  "users",
  "email_accounts",
  "email_threads",
  "email_messages",
  "email_message_attachments",
  "email_drafts",
  "email_thread_reads",
] as const;

async function retainedRows(h: TestDb): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  for (const table of tables) {
    const rows = await h.pool.query<{ value: unknown }>(
      `SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) AS value FROM public."${table}" t`,
    );
    result[table] = rows.rows[0]?.value;
  }
  return result;
}

// Prefix installation establishes the old customer fixture; application admission
// performs the exact populated 103 -> 104 upgrade.
it("upgrades populated 103-entry mailboxes without changing content, drafts or read watermarks", async () => {
  const h = await freshMigrationDb();
  let target: Awaited<ReturnType<typeof migrationFolder>> | undefined;
  try {
    target = await migrationFolder(104);
    await installPrefix(h, 103);
    expect(
      (await h.pool.query("SELECT to_regclass('public.email_read_intents') AS value")).rows,
    ).toEqual([{ value: null }]);
    const owner = await seedUser(h.db);
    const account = (
      await h.pool.query<{ id: string }>(
        "INSERT INTO email_accounts (user_id,email_address,provider,status,connection_generation,credential_version) VALUES ($1,'upgrade@example.test','imap_smtp','connected',7,3) RETURNING id",
        [owner.id],
      )
    ).rows[0];
    if (account === undefined) throw new Error("Upgrade account fixture missing");
    const thread = (
      await h.pool.query<{ id: string }>(
        "INSERT INTO email_threads (account_id,gmail_thread_id,subject,last_message_at,visibility) VALUES ($1,'upgrade-read-thread','Retained mail','2026-11-03 01:02:03.456789+00','private') RETURNING id",
        [account.id],
      )
    ).rows[0];
    if (thread === undefined) throw new Error("Upgrade thread fixture missing");
    const message = (
      await h.pool.query<{ id: string }>(
        "INSERT INTO email_messages (thread_id,account_id,gmail_message_id,direction,from_email,to_emails,cc_emails,subject,body_html,sent_at) VALUES ($1,$2,'upgrade-read-message','inbound','sender@example.test','[\"upgrade@example.test\"]','[\"cc@example.test\"]','Retained mail','<p>Keep this body</p>','2026-11-03 01:02:03.456789+00') RETURNING id",
        [thread.id, account.id],
      )
    ).rows[0];
    if (message === undefined) throw new Error("Upgrade message fixture missing");
    await h.pool.query(
      "INSERT INTO email_message_attachments (message_id,account_id,gmail_attachment_id,filename,mime_type,size_bytes) VALUES ($1,$2,'kept-attachment','kept.txt','text/plain',5)",
      [message.id, account.id],
    );
    await h.pool.query(
      'INSERT INTO email_drafts (account_id,thread_id,subject,body_html,to_emails,cc_emails,bcc_emails,attachments) VALUES ($1,$2,\'Unsent reply\',\'<p>Keep this draft</p>\',\'["to@example.test"]\',\'["cc@example.test"]\',\'["bcc@example.test"]\',\'[{"objectKey":"fixture/kept","filename":"kept.txt","mimeType":"text/plain","sizeBytes":5}]\')',
      [account.id, thread.id],
    );
    await h.pool.query(
      "INSERT INTO email_thread_reads (thread_id,user_id,read_at) VALUES ($1,$2,'2026-11-03 01:02:03.456788+00')",
      [thread.id, owner.id],
    );
    const before = await retainedRows(h);
    const oldLedger = await ledger(h);
    expect(oldLedger).toHaveLength(103);
    const signal = () => AbortSignal.timeout(15_000);
    expect(await applyMigrations(h.db, signal(), target.folder)).toEqual({
      ok: true,
      value: { applied: true },
    });
    expect(await retainedRows(h)).toEqual(before);
    const upgradedLedger = await ledger(h);
    expect(upgradedLedger).toHaveLength(104);
    expect(upgradedLedger.slice(0, 103)).toEqual(oldLedger);
    expect(
      (await h.pool.query("SELECT count(*)::integer AS count FROM email_read_intents")).rows,
    ).toEqual([{ count: 0 }]);
    const read = await getThread(
      h.db,
      {
        actor: { id: owner.id, type: "regular", isActive: true, groupIds: new Set() },
        threadId: thread.id,
        allowRemote: false,
      },
      signal(),
    );
    expect(read.ok && read.value.thread.unread).toBe(true);
    expect(read.ok && read.value.messages[0]?.attachments[0]?.filename).toBe("kept.txt");
    expect(await applyMigrations(h.db, signal(), target.folder)).toEqual({
      ok: true,
      value: { applied: true },
    });
    expect(await ledger(h)).toEqual(upgradedLedger);
    expect(await retainedRows(h)).toEqual(before);
  } finally {
    try {
      await target?.dispose();
    } finally {
      await h.close();
    }
  }
});
