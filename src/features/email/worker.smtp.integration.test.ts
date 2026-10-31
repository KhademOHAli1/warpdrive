import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { ok } from "@/types/result";
import { smtpOutboxFixture } from "./smtpOutbox.test-helpers";
import { runSendJob } from "./worker";

it("promotes a scheduled independent send once without resolving Gmail credentials", async () => {
  await withTestDb(async (db) => {
    const f = await smtpOutboxFixture(db);
    try {
      await f.enqueue({
        subject: "پیشنهاد همکاری",
        html: "<p>Vielen Dank für Ihre Rückmeldung.</p>",
      });
      await db.execute(
        sql`UPDATE email_send_attempts SET scheduled_at=now()-interval '1 second' WHERE id=${f.attemptId}`,
      );
      const deps = {
        resolveClient: () => {
          throw new Error("Independent mail must never resolve Google credentials");
        },
        loadMail: () => Promise.resolve(ok(f.runtime)),
        storage: f.storage,
      };
      const args = {
        accountId: f.accountId,
        idempotencyKey: f.idempotencyKey,
        signal: AbortSignal.timeout(30_000),
      };
      const sent = await runSendJob(db, args, deps);
      expect(sent.ok && sent.value.status).toBe("sent");
      const replay = await runSendJob(db, args, deps);
      expect(replay.ok && replay.value.status).toBe("sent");
      expect(f.smtp.received).toHaveLength(1);
      expect(
        (await db.execute(sql`SELECT id FROM email_messages WHERE account_id=${f.accountId}`)).rows,
      ).toHaveLength(1);
    } finally {
      await f.close();
    }
  });
});
