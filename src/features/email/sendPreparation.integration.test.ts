import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { enqueueSend } from "./outbox";
import { processSmtpSendAttempt } from "./smtpOutbox";
import { smtpOutboxFixture } from "./smtpOutbox.test-helpers";

it("never submits an unprepared outbox payload while the request prepares its signature", async () => {
  await withTestDb(async (db) => {
    const f = await smtpOutboxFixture(db);
    try {
      const key = randomUUID();
      const queued = await enqueueSend(db, {
        accountId: f.accountId,
        idempotencyKey: key,
        payload: { to: ["customer@mail.test"], subject: "Angebot", html: "<p>پیشنهاد</p>" },
        requiresPreparation: true,
      });
      expect(queued.ok).toBe(true);
      const result = await processSmtpSendAttempt(db, { ...f.args, idempotencyKey: key });
      expect(result.ok && result.value.status).toBe("pending");
      expect(f.smtp.received).toHaveLength(0);
      const row = (
        await db.execute(
          sql`SELECT send_started_at,payload_prepared FROM email_send_attempts WHERE idempotency_key=${key}`,
        )
      ).rows[0];
      expect(row).toMatchObject({ send_started_at: null, payload_prepared: false });
    } finally {
      await f.close();
    }
  });
});
