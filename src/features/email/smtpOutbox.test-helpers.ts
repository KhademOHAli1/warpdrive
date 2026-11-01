import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { seedUser } from "@/db/testing/factories";
import { FakeStorageClient } from "@/features/files/storageFake";
import { startMailProtocolImap } from "@/test/mailProtocolImap";
import { startMailProtocolSmtp } from "@/test/mailProtocolSmtp";
import type { ImapConnectionRuntime } from "./mailConnectionRuntime";
import type { SendPayload } from "./outboxClaim";
import { createImapTransport } from "./providers/imap";
import { createSmtpTransport } from "./providers/smtp";

export async function smtpOutboxFixture(
  db: Db,
  options: Parameters<typeof startMailProtocolSmtp>[0] = {},
) {
  const owner = await seedUser(db);
  const accountId = randomUUID();
  const attemptId = randomUUID();
  const idempotencyKey = randomUUID();
  await db.execute(sql`INSERT INTO email_accounts
    (id,user_id,email_address,provider,connection_settings)
    VALUES (${accountId},${owner.id},'owner@mail.test','imap_smtp','{"sentCopyMode":"crm_only"}'::jsonb)`);
  const imap = await startMailProtocolImap();
  const smtp = await startMailProtocolSmtp(options);
  const credentials = { username: "owner@mail.test", password: "synthetic-password" };
  const runtime: ImapConnectionRuntime = {
    accountId,
    ownerId: owner.id,
    generation: 1,
    emailAddress: "owner@mail.test",
    historyDays: 90,
    folderPaths: ["INBOX", "Sent"],
    imap: createImapTransport({ ...credentials, endpoint: imap.endpoint }),
    smtp: createSmtpTransport({ ...credentials, endpoint: smtp.endpoint }),
  };
  const storage = new FakeStorageClient();
  async function enqueue(payload: Partial<SendPayload> = {}) {
    await db.execute(sql`INSERT INTO email_send_attempts
      (id,idempotency_key,message_id_header,account_id,payload,connection_generation)
      VALUES (${attemptId},${idempotencyKey},${`<${attemptId}@mail.test>`},${accountId},
        ${JSON.stringify({ to: ["customer@mail.test"], subject: "Grüße", html: "<p>Vielen Dank</p>", ...payload })}::jsonb,1)`);
  }
  return {
    owner,
    accountId,
    attemptId,
    idempotencyKey,
    runtime,
    storage,
    smtp,
    imap,
    enqueue,
    args: { accountId, idempotencyKey, runtime, storage, signal: AbortSignal.timeout(30_000) },
    async close() {
      await imap.close();
      await smtp.close();
    },
  };
}
