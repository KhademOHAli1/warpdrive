import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { seedUser } from "@/db/testing/factories";
import { startMailProtocolImap } from "@/test/mailProtocolImap";
import { ok } from "@/types/result";
import type { ImapConnectionRuntime } from "./mailConnectionRuntime";
import { buildMime } from "./mime";
import { createImapTransport } from "./providers/imap";
import { createSmtpTransport } from "./providers/smtp";

export const IMAP_SYNC_NOW = new Date("2026-10-31T13:00:00Z");

export async function imapSyncFixture(db: Db, folderPaths = ["INBOX"]) {
  const owner = await seedUser(db);
  const accountId = randomUUID();
  await db.execute(sql`INSERT INTO email_accounts
    (id,user_id,email_address,provider,history_days,folder_paths,status)
    VALUES (${accountId},${owner.id},${`${accountId}@mail.test`},'imap_smtp',90,${JSON.stringify(folderPaths)}::jsonb,'connected')`);
  const server = await startMailProtocolImap();
  const messages = server.state.folders.get("INBOX")?.messages;
  if (messages === undefined)
    throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "Missing fixture messages");
  const [old, original, reply] = messages;
  if (old === undefined || original === undefined || reply === undefined)
    throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "Missing fixture messages");
  old.date = new Date("2026-06-01T12:00Z");
  original.source = Buffer.from(
    buildMime({
      from: "Kunde <client@mail.test>",
      to: [`${accountId}@mail.test`],
      subject: "Angebot für Sie",
      html: "<p>Grüße aus Berlin</p>",
      text: "Grüße aus Berlin",
      messageId: "<original@mail.test>",
    }),
  );
  reply.source = Buffer.from(
    buildMime({
      from: "client@mail.test",
      to: [`${accountId}@mail.test`],
      subject: "پاسخ پیشنهاد همکاری",
      html: "<p>از پیشنهاد شما سپاسگزاریم</p>",
      text: "از پیشنهاد شما سپاسگزاریم",
      messageId: "<reply@mail.test>",
      inReplyTo: "<original@mail.test>",
      references: "<original@mail.test>",
      attachments: [
        { filename: "پیشنهاد.pdf", contentType: "application/pdf", bytes: Buffer.from("%PDF-1.7") },
      ],
    }),
  );
  const config = {
    endpoint: server.endpoint,
    username: "owner@mail.test",
    password: "synthetic-password",
  };
  const runtime: ImapConnectionRuntime = {
    accountId,
    ownerId: owner.id,
    generation: 1,
    emailAddress: `${accountId}@mail.test`,
    historyDays: 90,
    folderPaths,
    imap: createImapTransport(config),
    smtp: createSmtpTransport(config),
  };
  return {
    accountId,
    owner,
    server,
    runtime,
    deps: { loadConnection: () => Promise.resolve(ok(runtime)) },
  };
}
