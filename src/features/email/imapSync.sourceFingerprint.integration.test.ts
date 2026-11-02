import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { movedSmtpCopyFixture } from "./imapSync.sourceFingerprint.test-helpers";

describe("account-scoped IMAP source aliases", () => {
  it.each([true, false])(
    "retains an accepted SMTP UUID after MOVE without COPYUID (observed=%s)",
    async (observed) => {
      await withTestDb(async (db) => {
        const f = await movedSmtpCopyFixture(db, { observed, signal: AbortSignal.timeout(30_000) });
        try {
          expect(await f.sync()).toMatchObject({ ok: true, value: { applied: 0, more: false } });
          const messages = (
            await db.execute(
              sql`SELECT id,message_fingerprint FROM email_messages WHERE account_id=${f.accountId}`,
            )
          ).rows;
          expect(messages).toEqual([{ id: f.messageId, message_fingerprint: null }]);
          expect(
            (
              await db.execute(
                sql`SELECT id,message_id,provider_locator FROM email_message_attachments WHERE account_id=${f.accountId} ORDER BY id`,
              )
            ).rows,
          ).toEqual(f.attachmentRows);
          expect(
            (
              await db.execute(
                sql`SELECT l.message_id,f.path,l.active FROM mail_message_locators l JOIN mail_folders f ON f.id=l.folder_id WHERE l.account_id=${f.accountId} ORDER BY f.path`,
              )
            ).rows,
          ).toEqual([
            { message_id: f.messageId, path: "Archiv", active: true },
            { message_id: f.messageId, path: "Sent", active: false },
          ]);
          expect(await f.sync()).toMatchObject({ ok: true, value: { applied: 0 } });
          expect(f.smtp.received).toHaveLength(1);
        } finally {
          await f.close();
        }
      });
    },
  );

  it("does not reuse another account's UUID for identical source and RFC headers", async () => {
    await withTestDb(async (db) => {
      const f = await movedSmtpCopyFixture(db, {
        observed: true,
        signal: AbortSignal.timeout(30_000),
      });
      try {
        const owner = await seedUser(db);
        const accountId = randomUUID();
        await db.execute(
          sql`INSERT INTO email_accounts (id,user_id,email_address,provider) VALUES (${accountId},${owner.id},${`${accountId}@mail.test`},'imap_smtp')`,
        );
        const runtime = {
          ...f.runtime,
          accountId,
          ownerId: owner.id,
          emailAddress: `${accountId}@mail.test`,
          folderPaths: ["Archiv"],
        };
        expect(await f.sync(runtime)).toMatchObject({
          ok: true,
          value: { applied: 1, more: false },
        });
        const imported = (
          await db.execute(
            sql`SELECT id,account_id FROM email_messages WHERE account_id=${accountId}`,
          )
        ).rows;
        expect(imported).toHaveLength(1);
        expect(imported[0]?.id).not.toBe(f.messageId);
        expect(imported[0]?.account_id).toBe(accountId);
        expect(
          (await db.execute(sql`SELECT id FROM email_messages WHERE account_id=${f.accountId}`))
            .rows,
        ).toEqual([{ id: f.messageId }]);
      } finally {
        await f.close();
      }
    });
  });

  it("imports changed raw bytes separately even when body, RFC ID and send-attempt hint match", async () => {
    await withTestDb(async (db) => {
      const f = await movedSmtpCopyFixture(db, {
        observed: true,
        signal: AbortSignal.timeout(30_000),
      });
      try {
        f.moved.source = Buffer.concat([
          Buffer.from("Received: by another.copy.test\r\n"),
          f.originalSource,
        ]);
        expect(await f.sync()).toMatchObject({ ok: true, value: { applied: 1, more: false } });
        const messages = (
          await db.execute(
            sql`SELECT id,rfc_message_id FROM email_messages WHERE account_id=${f.accountId}`,
          )
        ).rows;
        expect(messages).toHaveLength(2);
        expect(messages.some((row) => row.id === f.messageId)).toBe(true);
        expect(new Set(messages.map((row) => row.rfc_message_id)).size).toBe(1);
      } finally {
        await f.close();
      }
    });
  });

  it("does not collapse ambiguous historical UUIDs and advances the ordinary import cursor", async () => {
    await withTestDb(async (db) => {
      const f = await movedSmtpCopyFixture(db, {
        observed: true,
        signal: AbortSignal.timeout(30_000),
      });
      try {
        const duplicateId = randomUUID();
        await db.execute(sql`INSERT INTO email_messages (id,thread_id,account_id,provider_message_id,rfc_message_id,direction,from_email,body_text)
          SELECT ${duplicateId},thread_id,account_id,${`synthetic:${duplicateId}`},rfc_message_id,direction,from_email,body_text FROM email_messages WHERE id=${f.messageId}`);
        const folderId = randomUUID();
        await db.execute(
          sql`INSERT INTO mail_folders (id,account_id,path,uid_validity) VALUES (${folderId},${f.accountId},'Historical ambiguous copy','777')`,
        );
        // This deliberate historical conflict needs the nullable/nonunique91 column.
        // The first behavioral RED is the observed=true MOVE case above, before any DDL.
        const inserted =
          await db.execute(sql`INSERT INTO mail_message_locators (account_id,folder_id,uid_validity,uid,message_id,active,source_fingerprint)
          SELECT ${f.accountId},${folderId},'777',1,${duplicateId},false,source_fingerprint FROM mail_message_locators
          WHERE account_id=${f.accountId} AND message_id=${f.messageId} LIMIT 1 RETURNING id`);
        expect(inserted.rows).toHaveLength(1);
        expect(await f.sync()).toMatchObject({ ok: true, value: { applied: 1, more: false } });
        const messages = (
          await db.execute(sql`SELECT id FROM email_messages WHERE account_id=${f.accountId}`)
        ).rows;
        expect(messages).toHaveLength(3);
        expect(messages.some((row) => row.id === f.messageId)).toBe(true);
        expect(messages.some((row) => row.id === duplicateId)).toBe(true);
        const target = (
          await db.execute(
            sql`SELECT l.message_id FROM mail_message_locators l JOIN mail_folders f ON f.id=l.folder_id WHERE l.account_id=${f.accountId} AND f.path='Archiv' AND l.active=true`,
          )
        ).rows[0]?.message_id;
        expect(target).not.toBe(f.messageId);
        expect(target).not.toBe(duplicateId);
        expect(
          (
            await db.execute(
              sql`SELECT last_uid FROM mail_folders WHERE account_id=${f.accountId} AND path='Archiv'`,
            )
          ).rows,
        ).toEqual([{ last_uid: "1" }]);
        expect(await f.sync()).toMatchObject({ ok: true, value: { applied: 0, more: false } });
      } finally {
        await f.close();
      }
    });
  });
});
