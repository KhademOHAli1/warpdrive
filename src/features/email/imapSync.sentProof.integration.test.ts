import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { ok } from "@/types/result";
import { runImapSyncJob } from "./imapSync";
import { IMAP_SYNC_NOW } from "./imapSync.test-helpers";
import { processSmtpSendAttempt } from "./smtpOutbox";
import { smtpOutboxFixture } from "./smtpOutbox.test-helpers";

it.each(["authoritative", "inbox", "guessed", "changed"] as const)(
  "uses account-qualified accepted Sent proof only with authoritative intact content (%s)",
  async (kind) => {
    await withTestDb(async (db) => {
      const f = await smtpOutboxFixture(db);
      try {
        await f.enqueue({
          subject: "پیگیری / Rückfrage",
          text: "Vielen Dank",
          html: "<p>Grüße aus Köln</p>",
        });
        expect(await processSmtpSendAttempt(db, f.args)).toMatchObject({
          ok: true,
          value: { status: "sent" },
        });
        const raw = f.smtp.received[0];
        if (raw === undefined) throw new Error("Missing submitted source");
        const path = kind === "inbox" ? "INBOX" : "Sent";
        const folder = f.imap.state.folders.get(path);
        if (folder === undefined) throw new Error("Missing candidate folder");
        if (kind === "guessed") folder.specialUse = null;
        folder.messages = [
          {
            uid: 1,
            flags: ["\\Seen"],
            date: IMAP_SYNC_NOW,
            source: Buffer.concat([
              Buffer.from("Received: by synthetic.mail.test\r\n"),
              kind === "changed"
                ? Buffer.from(raw.toString().replace("Vielen Dank", "Different body"))
                : raw,
            ]),
          },
        ];
        f.runtime.folderPaths = [path];
        const synced = await runImapSyncJob(
          db,
          { accountId: f.accountId, signal: f.args.signal, now: IMAP_SYNC_NOW },
          { loadConnection: () => Promise.resolve(ok(f.runtime)) },
        );
        expect(synced).toMatchObject({
          ok: true,
          value: { applied: kind === "authoritative" ? 0 : 1 },
        });
        const messages = (
          await db.execute(sql`SELECT id FROM email_messages WHERE account_id=${f.accountId}`)
        ).rows;
        expect(messages).toHaveLength(kind === "authoritative" ? 1 : 2);
        const locators = (
          await db.execute(
            sql`SELECT message_id FROM mail_message_locators WHERE account_id=${f.accountId}`,
          )
        ).rows;
        expect(locators).toHaveLength(1);
        if (kind === "authoritative") expect(locators[0]?.message_id).toBe(messages[0]?.id);
      } finally {
        await f.close();
      }
    });
  },
);
