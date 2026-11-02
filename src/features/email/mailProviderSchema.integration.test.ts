import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";

it("stores independent provider identities without inventing Gmail ids, preserving scoped foreign keys", async () => {
  await withTestDb(async (db) => {
    const owner = await seedUser(db);
    const account = randomUUID();
    const thread = randomUUID();
    const message = randomUUID();
    await db.execute(
      sql`INSERT INTO email_accounts (id,user_id,email_address,provider) VALUES (${account},${owner.id},'own@example.test','imap_smtp')`,
    );
    await db.execute(
      sql`INSERT INTO email_threads (id,account_id,provider_thread_id) VALUES (${thread},${account},'imap:thread:1')`,
    );
    await db.execute(sql`
      INSERT INTO email_messages (id,thread_id,account_id,provider_message_id,rfc_message_id,message_fingerprint,direction,from_email)
      VALUES (${message},${thread},${account},'imap:INBOX:1:1','<message@example.test>','source-fingerprint','inbound','sender@example.test')
    `);
    const row = (
      await db.execute(
        sql`SELECT gmail_message_id,provider_message_id FROM email_messages WHERE id=${message}`,
      )
    ).rows[0];
    expect(row).toEqual({ gmail_message_id: null, provider_message_id: "imap:INBOX:1:1" });
    const anotherAccount = randomUUID();
    await db.execute(
      sql`INSERT INTO email_accounts (id,user_id,email_address,provider) VALUES (${anotherAccount},${owner.id},'other@example.test','imap_smtp')`,
    );
    await expect(
      db.execute(sql`
      INSERT INTO email_messages (thread_id,account_id,provider_message_id,direction,from_email)
      VALUES (${thread},${anotherAccount},'imap:INBOX:1:1','inbound','sender@example.test')
    `),
    ).rejects.toMatchObject({ cause: { code: "23503", constraint: "fk_msg_thread_same_mailbox" } });
  });
});
