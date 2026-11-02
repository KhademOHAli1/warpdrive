import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { env } from "@/config/env";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { FakeStorageClient } from "@/features/files/storageFake";
import { startMailProtocolImap } from "@/test/mailProtocolImap";
import { startMailProtocolSmtp } from "@/test/mailProtocolSmtp";
import type { ImapConnectionRuntime } from "./mailConnectionRuntime";
import { createImapTransport } from "./providers/imap";
import { parseRawMime } from "./providers/rawMime";
import { createSmtpTransport } from "./providers/smtp";
import { sendEmail } from "./send";

for (const [locale, subject, text] of [
  ["fa", "پیگیری پیشنهاد همکاری", "سلام، پیشنهاد همکاری پیوست شده است."],
  ["de", "Rückfrage zu unserem Angebot", "Guten Tag, hier ist unser überarbeitetes Angebot."],
] as const)
  it(`sends ${locale} through the shared composer pipeline with no Gmail client or duplicate replay`, async () => {
    const imap = await startMailProtocolImap();
    const smtp = await startMailProtocolSmtp();
    try {
      await withTestDb(async (db) => {
        const owner = await seedUser(db);
        const accountId = randomUUID();
        await db.execute(sql`
        INSERT INTO email_accounts (id,user_id,email_address,provider,connection_settings)
        VALUES (${accountId},${owner.id},'owner@mail.test','imap_smtp','{"sentCopyMode":"crm_only"}'::jsonb)
      `);
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
        const args = {
          actorId: owner.id,
          actorType: "regular" as const,
          actorGroupIds: new Set<string>(),
          mail: runtime,
          storage: new FakeStorageClient(),
          signal: AbortSignal.timeout(30_000),
          input: {
            accountId,
            idempotencyKey: randomUUID(),
            to: ["customer@mail.test"],
            bcc: ["private-copy@mail.test"],
            subject,
            bodyHtml: `<p>${text}</p>`,
          },
        };
        const sent = await sendEmail(db, args);
        expect(sent.ok).toBe(true);
        if (sent.ok) expect(sent.value.status).toBe("sent");
        expect(smtp.received).toHaveLength(1);
        expect(smtp.received[0]!.toString()).not.toContain("private-copy@mail.test");
        const parsed = await parseRawMime({
          source: smtp.received[0]!,
          signal: AbortSignal.timeout(5000),
        });
        expect(parsed.ok).toBe(true);
        if (parsed.ok) {
          expect(parsed.value.subject).toBe(subject);
          expect(parsed.value.rfcMessageId?.endsWith(`@${new URL(env.BASE_URL).hostname}>`)).toBe(
            true,
          );
          expect(parsed.value.html).toContain(text);
        }
        const replay = await sendEmail(db, {
          ...args,
          input: {
            ...args.input,
            bodyHtml: "<p>Changed retry text must never replace an accepted snapshot.</p>",
            signatureId: randomUUID(),
            attachments: [{ fileId: randomUUID() }],
          },
        });
        expect(replay.ok).toBe(true);
        expect(smtp.received).toHaveLength(1);
        const copies = (
          await db.execute(
            sql`SELECT provider_message_id,gmail_message_id,direction FROM email_messages WHERE account_id=${accountId}`,
          )
        ).rows;
        expect(copies).toHaveLength(1);
        expect(copies[0]).toMatchObject({ gmail_message_id: null, direction: "outbound" });
      });
    } finally {
      await imap.close();
      await smtp.close();
    }
  });
