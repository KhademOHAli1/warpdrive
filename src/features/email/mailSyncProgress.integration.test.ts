import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { listActorMailboxes } from "./mailAccountsRepo";

it("reports selected current-epoch processed and skipped items without leaking remote locators", async () => {
  await withTestDb(async (db) => {
    const owner = await seedUser(db);
    const accountId = randomUUID();
    await db.execute(sql`INSERT INTO email_accounts(id,user_id,email_address,provider,folder_paths)
      VALUES(${accountId},${owner.id},'owner@mail.test','imap_smtp','["INBOX"]'::jsonb)`);
    const folder = randomUUID();
    await db.execute(
      sql`INSERT INTO mail_folders(id,account_id,path,uid_validity) VALUES(${folder},${accountId},'INBOX','12')`,
    );
    const reasons = ["message_too_large", "invalid_message", "message_missing"];
    for (const [index, reason] of reasons.entries())
      await db.execute(sql`INSERT INTO mail_message_locators
      (account_id,folder_id,uid_validity,uid,skipped_reason) VALUES(${accountId},${folder},'12',${index + 1},${reason})`);
    await db.execute(sql`INSERT INTO mail_message_locators(account_id,folder_id,uid_validity,uid,skipped_reason)
      VALUES(${accountId},${folder},'old-epoch',99,'invalid_message')`);
    const row = (await listActorMailboxes(db, owner.id, AbortSignal.timeout(10_000)))[0];
    expect(row?.syncProgress).toEqual({
      processed: 3,
      total: null,
      skipped: 3,
      skipReasons: { messageTooLarge: 1, invalidMessage: 1, messageMissing: 1 },
    });
    expect(JSON.stringify(row)).not.toMatch(/old-epoch|uidValidity|skipped_reason/);
  });
});
