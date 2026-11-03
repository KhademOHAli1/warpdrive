import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { expect } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { oauthAccessTokens, oauthAuthCodes, oauthClients, oauthRefreshTokens } from "@/db/schema";
import { seedUser } from "@/db/testing/factories";
import { saveDraft } from "./draftRepo";
import type { SoftMailbox } from "./readIntentSoftLifecycleConnection.test-helpers";
import { softSignal } from "./readIntentSoftLifecycleConnection.test-helpers";

export async function seedSoftData(db: Db, mailbox: SoftMailbox) {
  const bytes = Buffer.from("%PDF-1.7 soft lifecycle reference\n");
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const [person] = (
    await db.execute(sql`INSERT INTO persons(name,owner_id,visibility_level)
      VALUES('Soft lifecycle attachment owner',${mailbox.actor.id},'all') RETURNING id`)
  ).rows;
  if (typeof person?.id !== "string")
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Attachment parent fixture missing");
  const [file] = (
    await db.execute(sql`INSERT INTO files(entity_type,entity_id,filename,s3_key,size_bytes,
      content_type,etag,status,uploaded_by)
      VALUES('person',${person.id},'reference.pdf','synthetic/soft-lifecycle/reference.pdf',
        ${bytes.length},'application/pdf',${checksum},'ready',${mailbox.actor.id}) RETURNING id`)
  ).rows;
  if (typeof file?.id !== "string")
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Attachment metadata fixture missing");
  await db.execute(sql`INSERT INTO email_message_attachments(message_id,account_id,filename,
    mime_type,size_bytes,provider_locator) VALUES(${mailbox.messageId},${mailbox.accountId},
    'reference.pdf','application/pdf',${bytes.length},${JSON.stringify({
      kind: "stored",
      objectKey: "synthetic/soft-lifecycle/reference.pdf",
      sha256: checksum,
    })}::jsonb)`);
  const draft = await saveDraft(
    db,
    {
      actor: mailbox.actor,
      draft: {
        accountId: mailbox.accountId,
        threadId: mailbox.threadId,
        subject: "Retain this reply · پاسخ",
        bodyHtml: "<p>Draft body survives every soft lifecycle action.</p>",
        toEmails: ["to@example.test"],
        ccEmails: ["cc@example.test"],
        bccEmails: ["bcc@example.test"],
        attachments: [{ fileId: file.id }],
        visibility: "private",
      },
    },
    softSignal(),
  );
  if (!draft.ok) throw draft.error;
  // Deliberate PG microsecond watermark, never round-tripped through a JS Date.
  await db.execute(sql`INSERT INTO email_thread_reads(thread_id,user_id,read_at)
    VALUES(${mailbox.threadId},${mailbox.actor.id},'2026-11-02 12:34:56.123456+00')
    ON CONFLICT(thread_id,user_id) DO UPDATE SET read_at=EXCLUDED.read_at`);
  const unrelatedOwner = await seedUser(db);
  const [unrelated] = (
    await db.execute(sql`INSERT INTO email_accounts(user_id,email_address,status)
      VALUES(${unrelatedOwner.id},${`${unrelatedOwner.id}@example.test`},'connected') RETURNING id`)
  ).rows;
  if (typeof unrelated?.id !== "string")
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Unrelated mailbox fixture missing");
  await db.execute(sql`WITH thread AS (INSERT INTO email_threads(account_id,gmail_thread_id,
      subject,last_message_at) VALUES(${unrelated.id},'unrelated-soft-lifecycle','Unrelated',now())
      RETURNING id)
    INSERT INTO email_messages(account_id,thread_id,gmail_message_id,direction,from_email,
      body_html,sent_at) SELECT ${unrelated.id},id,'unrelated-message','inbound',
      'unrelated@example.test','<p>Unrelated content</p>',now() FROM thread`);
  const admin = await seedUser(db, { isAdmin: true });
  const clientId = `soft-lifecycle-${randomUUID()}`;
  await db.insert(oauthClients).values({
    id: clientId,
    name: "Soft lifecycle synthetic MCP grant",
    redirectUris: ["https://client.example.test/callback"],
  });
  const expiresAt = new Date(Date.now() + 3_600_000);
  await db.insert(oauthAccessTokens).values({
    jti: randomUUID(),
    userId: mailbox.actor.id,
    clientId,
    expiresAt,
  });
  await db.insert(oauthRefreshTokens).values({
    tokenHash: randomUUID(),
    userId: mailbox.actor.id,
    clientId,
    expiresAt,
  });
  await db.insert(oauthAuthCodes).values({
    codeHash: randomUUID(),
    userId: mailbox.actor.id,
    clientId,
    redirectUri: "https://client.example.test/callback",
    codeChallenge: "synthetic",
    expiresAt,
  });
  return {
    fileId: file.id,
    draftId: draft.value.id,
    checksum,
    unrelatedAccountId: unrelated.id,
    adminId: admin.id,
  };
}

export type SoftData = Awaited<ReturnType<typeof seedSoftData>>;
type SnapshotScope = Pick<SoftMailbox, "actor" | "accountId" | "threadId"> & SoftData;

export interface SoftSnapshot {
  receipts: unknown;
  content: unknown;
  marker: unknown;
  unrelated: unknown;
}

export async function snapshotSoftData(db: Db, f: SnapshotScope): Promise<SoftSnapshot> {
  const [row] = (
    await db.execute(sql`SELECT jsonb_build_object(
    'receipts',(SELECT jsonb_agg(to_jsonb(i) ORDER BY operation_id) FROM email_read_intents i
      WHERE actor_id=${f.actor.id} AND account_id=${f.accountId}),
    'content',jsonb_build_object(
      'thread',(SELECT jsonb_build_object('id',id,'account_id',account_id,'subject',subject,
        'last_message_at',last_message_at,'visibility',visibility,'person_id',person_id,
        'deal_id',deal_id,'archived_at',archived_at) FROM email_threads WHERE id=${f.threadId}),
      'messages',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM email_messages m WHERE thread_id=${f.threadId}),
      'drafts',(SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM email_drafts d WHERE account_id=${f.accountId}),
      'attachments',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM email_message_attachments a WHERE account_id=${f.accountId}),
      'file',(SELECT to_jsonb(f) FROM files f WHERE id=${f.fileId})),
    'marker',(SELECT to_jsonb(r) FROM email_thread_reads r WHERE thread_id=${f.threadId} AND user_id=${f.actor.id}),
    'unrelated',jsonb_build_object(
      'account',(SELECT to_jsonb(a) FROM email_accounts a WHERE id=${f.unrelatedAccountId}),
      'threads',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM email_threads t WHERE account_id=${f.unrelatedAccountId}),
      'messages',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM email_messages m WHERE account_id=${f.unrelatedAccountId}))) AS value`)
  ).rows;
  if (row?.value === undefined || row.value === null)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Soft lifecycle snapshot missing");
  return row.value as SoftSnapshot;
}

export function expectSoftPreserved(before: SoftSnapshot, after: SoftSnapshot) {
  expect(after.receipts).toEqual(before.receipts);
  expect(after.content).toEqual(before.content);
  expect(after.marker).toEqual(before.marker);
  expect(after.unrelated).toEqual(before.unrelated);
}
