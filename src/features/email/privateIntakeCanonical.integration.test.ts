import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { z } from "zod";
import type { Db } from "@/db/client";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { expectPrivateIntakePgError } from "./privateIntakeSchema.test-helpers";

const DATE = "2026-11-01T10:00:00.123456Z";
const EPOCH_US = Date.parse("2026-11-01T10:00:00Z") * 1000 + 123456;
const LOW = "10000000-0000-4000-8000-000000000001";
const HIGH = "f0000000-0000-4000-8000-000000000002";
const signal = () => AbortSignal.timeout(15_000);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const baselineSchema = z.strictObject({ message_hash: hash, thread_hash: hash, attachments_hash: hash });
const projectionSchema = z.record(z.string(), z.unknown());
type Fixture = Awaited<ReturnType<typeof seedCanonicalRows>>;

async function requireKernel(db: DbOrTx, abort: AbortSignal) {
  const result = await db.execute(sql`SELECT
    to_regprocedure('public.private_intake_hash_v1(jsonb)') IS NOT NULL AS hash,
    to_regprocedure('public.private_intake_message_v1(public.email_messages)') IS NOT NULL AS message,
    to_regprocedure('public.private_intake_thread_v1(public.email_threads)') IS NOT NULL AS thread,
    to_regprocedure('public.private_intake_attachment_v1(public.email_message_attachments)') IS NOT NULL AS attachment,
    to_regprocedure('public.private_intake_baseline_v1(uuid,uuid)') IS NOT NULL AS baseline`);
  abort.throwIfAborted();
  // Missing functions establish structural RED only, before behavioral qualification.
  expect(result.rows).toEqual([{ hash: true, message: true, thread: true, attachment: true, baseline: true }]);
}

async function baseline(db: DbOrTx, f: Fixture, abort: AbortSignal) {
  const result = await db.execute(sql`SELECT * FROM public.private_intake_baseline_v1(${f.accountId}::uuid,${f.messageId}::uuid)`);
  abort.throwIfAborted();
  expect(result.rows).toHaveLength(1);
  return baselineSchema.parse(result.rows[0]);
}

async function seedCanonicalRows(db: Db, abort: AbortSignal) {
  const owner = await seedUser(db);
  const accountId = randomUUID();
  const foreignAccountId = randomUUID();
  const threadId = randomUUID();
  const foreignThreadId = randomUUID();
  const messageId = randomUUID();
  const foreignMessageId = randomUUID();
  await db.execute(sql`INSERT INTO email_accounts(id,user_id,email_address,provider) VALUES
    (${accountId},${owner.id},${`${accountId}@mail.test`},'gmail'),
    (${foreignAccountId},${owner.id},${`${foreignAccountId}@mail.test`},'gmail')`);
  await db.execute(sql`INSERT INTO email_threads
    (id,account_id,provider_thread_id,subject,visibility,last_message_at,created_at,updated_at) VALUES
    (${threadId},${accountId},'private-intake:canonical','خصوصی / Privat','private',${DATE}::timestamptz,${DATE}::timestamptz,${DATE}::timestamptz),
    (${foreignThreadId},${foreignAccountId},'private-intake:foreign','Foreign','private',${DATE}::timestamptz,${DATE}::timestamptz,${DATE}::timestamptz)`);
  await db.execute(sql`INSERT INTO email_messages
    (id,account_id,thread_id,provider_message_id,direction,from_email,to_emails,subject,
      body_html,body_text,sent_at,created_at) VALUES
    (${messageId},${accountId},${threadId},'private-intake:canonical','inbound','sender@example.test',
      '["owner@example.test"]'::jsonb,'خصوصی / Privat','<p>سلام / Guten Tag</p>','سلام / Guten Tag',${DATE}::timestamptz,${DATE}::timestamptz),
    (${foreignMessageId},${foreignAccountId},${foreignThreadId},'private-intake:foreign','inbound',
      'foreign@example.test','[]'::jsonb,'Foreign',NULL,'Foreign body',${DATE}::timestamptz,${DATE}::timestamptz)`);
  // Insert in reverse UUID order so heap/insertion order cannot satisfy the ordering oracle.
  await db.execute(sql`INSERT INTO email_message_attachments
    (id,message_id,account_id,gmail_attachment_id,filename,mime_type,size_bytes,created_at) VALUES
    (${HIGH},${messageId},${accountId},'remote-high','پیشنهاد.pdf','application/pdf',7,${DATE}::timestamptz),
    (${LOW},${messageId},${accountId},'remote-low','Angebot.pdf','application/pdf',11,${DATE}::timestamptz)`);
  abort.throwIfAborted();
  return { accountId, foreignAccountId, threadId, messageId, foreignMessageId };
}

it("[structural] exposes the versioned private-intake SQL canonical kernel", async () => {
  await withTestDb(async (db) => requireKernel(db, signal()));
});

it("hashes UTF8 canonical JSONB with the installed pgcrypto kernel", async () => {
  await withTestDb(async (db) => {
    const abort = signal();
    await requireKernel(db, abort);
    const value = { fa: "محتوای خصوصی", de: "Grüße", missing: null, ordered: [2, 1] };
    const reordered = { ordered: [2, 1], missing: null, de: "Grüße", fa: "محتوای خصوصی" };
    const result = await db.execute(sql`SELECT
      public.private_intake_hash_v1(${JSON.stringify(value)}::jsonb) AS actual,
      encode(digest(convert_to((${JSON.stringify(value)}::jsonb)::text,'UTF8'),'sha256'),'hex') AS expected,
      public.private_intake_hash_v1(${JSON.stringify(reordered)}::jsonb) AS reordered,
      public.private_intake_hash_v1(NULL::jsonb) AS absent`);
    abort.throwIfAborted();
    const row = z.strictObject({ actual: hash, expected: hash, reordered: hash, absent: z.null() }).parse(result.rows[0]);
    expect(row.actual).toBe(row.expected);
    expect(row.reordered).toBe(row.expected);
  });
});

it("projects exactly v1 fields with explicit nulls and Unix microsecond timestamps", async () => {
  await withTestDb(async (db) => {
    const abort = signal();
    await requireKernel(db, abort);
    const f = await seedCanonicalRows(db, abort);
    const result = await db.execute(sql`SELECT public.private_intake_message_v1(m) AS message,
      public.private_intake_thread_v1(t) AS thread,public.private_intake_attachment_v1(a) AS attachment
      FROM email_messages m JOIN email_threads t ON t.id=m.thread_id AND t.account_id=m.account_id
      JOIN email_message_attachments a ON a.message_id=m.id AND a.account_id=m.account_id
      WHERE m.id=${f.messageId} AND a.id=${LOW}`);
    abort.throwIfAborted();
    const row = z.strictObject({ message: projectionSchema, thread: projectionSchema, attachment: projectionSchema }).parse(result.rows[0]);
    const keys = (value: Record<string, unknown>) => Object.keys(value).sort();
    expect(keys(row.message)).toEqual([
      "id", "thread_id", "account_id", "gmail_message_id", "provider_message_id", "rfc_message_id",
      "in_reply_to", "references", "message_fingerprint", "direction", "from_email", "from_name",
      "to_emails", "cc_emails", "subject", "snippet", "body_html", "body_text", "sent_at_us",
      "tracking_enabled", "created_at_us",
    ].sort());
    expect(keys(row.thread)).toEqual([
      "id", "account_id", "gmail_thread_id", "provider_thread_id", "subject", "deal_id", "lead_id",
      "person_id", "visibility", "last_message_at_us", "archived_at_us", "trashed_at_us",
      "remote_trashed_at_us", "follow_up_status", "labels", "created_at_us", "updated_at_us",
    ].sort());
    expect(keys(row.attachment)).toEqual([
      "id", "message_id", "account_id", "gmail_attachment_id", "provider_locator", "filename",
      "mime_type", "size_bytes", "created_at_us",
    ].sort());
    expect(row.message).toMatchObject({ sent_at_us: EPOCH_US, created_at_us: EPOCH_US,
      gmail_message_id: null, from_name: null, body_text: "سلام / Guten Tag" });
    expect(row.thread).toMatchObject({ last_message_at_us: EPOCH_US, created_at_us: EPOCH_US,
      updated_at_us: EPOCH_US, archived_at_us: null, trashed_at_us: null, remote_trashed_at_us: null });
    expect(row.attachment).toMatchObject({ created_at_us: EPOCH_US, provider_locator: null });
  });
});

it("keeps the same owned fixture stable across timezone and DateStyle changes", async () => {
  await withTestDb(async (db) => {
    const abort = signal();
    await requireKernel(db, abort);
    const f = await seedCanonicalRows(db, abort);
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('TimeZone','UTC',true),set_config('DateStyle','ISO, MDY',true)`);
      const initial = await baseline(tx, f, abort);
      await tx.execute(sql`SELECT set_config('TimeZone','Asia/Tehran',true),set_config('DateStyle','SQL, DMY',true)`);
      expect(await baseline(tx, f, abort)).toEqual(initial);
      await tx.execute(sql`SELECT set_config('TimeZone','UTC',true),set_config('DateStyle','German, DMY',true)`);
      expect(await baseline(tx, f, abort)).toEqual(initial);
    });
  });
});

it("ignores unrelated future columns added to every v1 projected table", async () => {
  await withTestDb(async (db) => {
    const abort = signal();
    await requireKernel(db, abort);
    const f = await seedCanonicalRows(db, abort);
    const initial = await baseline(db, f, abort);
    await db.execute(sql`ALTER TABLE email_messages ADD COLUMN private_intake_future_field text`);
    await db.execute(sql`ALTER TABLE email_threads ADD COLUMN private_intake_future_field text`);
    await db.execute(sql`ALTER TABLE email_message_attachments ADD COLUMN private_intake_future_field text`);
    await db.execute(sql`UPDATE email_messages SET private_intake_future_field='future message' WHERE id=${f.messageId}`);
    await db.execute(sql`UPDATE email_threads SET private_intake_future_field='future thread' WHERE id=${f.threadId}`);
    await db.execute(sql`UPDATE email_message_attachments SET private_intake_future_field='future attachment' WHERE message_id=${f.messageId}`);
    expect(await baseline(db, f, abort)).toEqual(initial);
  });
});

it.each(["body", "link", "attachment"] as const)("detects a semantic %s change", async (kind) => {
  await withTestDb(async (db) => {
    const abort = signal();
    await requireKernel(db, abort);
    const f = await seedCanonicalRows(db, abort);
    const initial = await baseline(db, f, abort);
    if (kind === "body") await db.execute(sql`UPDATE email_messages SET body_html='<p>Changed body</p>' WHERE id=${f.messageId}`);
    if (kind === "link") await db.execute(sql`UPDATE email_threads SET person_id=${randomUUID()} WHERE id=${f.threadId}`);
    if (kind === "attachment") await db.execute(sql`UPDATE email_message_attachments
      SET provider_locator=${JSON.stringify({ kind: "stored", objectKey: "changed", sha256: "a".repeat(64) })}::jsonb WHERE id=${LOW}`);
    const changed = await baseline(db, f, abort);
    const key = kind === "body" ? "message_hash" : kind === "link" ? "thread_hash" : "attachments_hash";
    expect(changed[key]).not.toBe(initial[key]);
    expect({ ...changed, [key]: initial[key] }).toEqual(initial);
  });
});

it("hashes the attachment array in UUID order rather than physical insertion order", async () => {
  await withTestDb(async (db) => {
    const abort = signal();
    await requireKernel(db, abort);
    const f = await seedCanonicalRows(db, abort);
    const initial = await baseline(db, f, abort);
    const ordered = await db.execute(sql`SELECT public.private_intake_hash_v1(
      jsonb_build_array(public.private_intake_attachment_v1(lo),public.private_intake_attachment_v1(hi))) AS expected
      FROM email_message_attachments lo CROSS JOIN email_message_attachments hi
      WHERE lo.id=${LOW} AND hi.id=${HIGH}`);
    abort.throwIfAborted();
    expect(initial.attachments_hash).toBe(ordered.rows[0]?.expected);
    // Keep the temporary snapshot and its use on one pinned connection.
    await db.transaction(async (tx) => {
      await tx.execute(sql`CREATE TEMP TABLE canonical_attachment_reorder ON COMMIT DROP AS
        SELECT * FROM email_message_attachments WHERE message_id=${f.messageId}`);
      await tx.execute(sql`DELETE FROM email_message_attachments WHERE message_id=${f.messageId}`);
      await tx.execute(sql`INSERT INTO email_message_attachments SELECT * FROM canonical_attachment_reorder ORDER BY id`);
      expect(await baseline(tx, f, abort)).toEqual(initial);
    });
  });
});

it("hashes an empty attachment collection as an explicit JSON array", async () => {
  await withTestDb(async (db) => {
    const abort = signal();
    await requireKernel(db, abort);
    const f = await seedCanonicalRows(db, abort);
    const initial = await baseline(db, f, abort);
    await db.execute(sql`DELETE FROM email_message_attachments WHERE message_id=${f.messageId}`);
    const empty = await baseline(db, f, abort);
    const expected = await db.execute(sql`SELECT public.private_intake_hash_v1('[]'::jsonb) AS hash`);
    abort.throwIfAborted();
    expect(empty).toEqual({ ...initial, attachments_hash: expected.rows[0]?.hash });
    expect(empty.attachments_hash).not.toBe(initial.attachments_hash);
  });
});

it("ignores unrelated attachment metadata from another mailbox of the same owner", async () => {
  await withTestDb(async (db) => {
    const abort = signal();
    await requireKernel(db, abort);
    const f = await seedCanonicalRows(db, abort);
    const initial = await baseline(db, f, abort);
    await db.execute(sql`INSERT INTO email_message_attachments
      (message_id,account_id,filename,mime_type,size_bytes) VALUES
      (${f.foreignMessageId},${f.foreignAccountId},'Foreign.pdf','application/pdf',29)`);
    expect(await baseline(db, f, abort)).toEqual(initial);
  });
});

it("rejects wrong-account attachment metadata attached to the owned message", async () => {
  await withTestDb(async (db) => {
    const abort = signal();
    await requireKernel(db, abort);
    const f = await seedCanonicalRows(db, abort);
    await db.execute(sql`INSERT INTO email_message_attachments
      (message_id,account_id,filename,mime_type,size_bytes) VALUES
      (${f.messageId},${f.foreignAccountId},'Foreign metadata.pdf','application/pdf',31)`);
    await expectPrivateIntakePgError(db.execute(sql`SELECT * FROM public.private_intake_baseline_v1(
      ${f.accountId}::uuid,${f.messageId}::uuid)`), ["23514"], abort);
  });
});

it("returns no baseline for a different mailbox's message even for the same owner", async () => {
  await withTestDb(async (db) => {
    const abort = signal();
    await requireKernel(db, abort);
    const f = await seedCanonicalRows(db, abort);
    const result = await db.execute(sql`SELECT * FROM public.private_intake_baseline_v1(
      ${f.accountId}::uuid,${f.foreignMessageId}::uuid)`);
    abort.throwIfAborted();
    expect(result.rows).toEqual([]);
  });
});
