import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { parseRawMime } from "./providers/rawMime";
import { sendEmail } from "./send";
import { smtpOutboxFixture } from "./smtpOutbox.test-helpers";

it("snapshots the configured Farsi/German sender name on the wire and CRM copy", async () => {
  await withTestDb(async (db) => {
    const f = await smtpOutboxFixture(db);
    try {
      const name = "تیم فروش · Vertrieb";
      await db.execute(sql`UPDATE email_accounts SET display_name=${name} WHERE id=${f.accountId}`);
      const args = {
        actorId: f.owner.id,
        actorType: "regular" as const,
        actorGroupIds: new Set<string>(),
        mail: f.runtime,
        storage: f.storage,
        signal: f.args.signal,
        input: {
          accountId: f.accountId,
          idempotencyKey: randomUUID(),
          to: ["customer@mail.test"],
          subject: "پیشنهاد",
          bodyHtml: "<p>Guten Tag</p>",
        },
      };
      expect((await sendEmail(db, args)).ok).toBe(true);
      const parsed = await parseRawMime({ source: f.smtp.received[0]!, signal: f.args.signal });
      expect(parsed.ok && parsed.value.from[0]?.name).toBe(name);
      expect(
        (
          await db.execute(
            sql`SELECT from_name FROM email_messages WHERE account_id=${f.accountId}`,
          )
        ).rows[0],
      ).toMatchObject({ from_name: name });
      await db.execute(
        sql`UPDATE email_accounts SET display_name='Later name' WHERE id=${f.accountId}`,
      );
      expect((await sendEmail(db, args)).ok).toBe(true);
      expect(f.smtp.received).toHaveLength(1);
      expect(
        (
          await db.execute(
            sql`SELECT payload->>'fromName' AS name FROM email_send_attempts WHERE account_id=${f.accountId}`,
          )
        ).rows[0],
      ).toMatchObject({ name });
    } finally {
      await f.close();
    }
  });
});
