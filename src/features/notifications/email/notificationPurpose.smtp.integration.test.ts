import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { enqueueSend } from "@/features/email/outbox";
import { runSendJob } from "@/features/email/worker";
import { notificationSmtpFixture } from "./notificationDispatch.test-helpers";

it("does not trust a persisted purpose that names a different recipient than the canonical notification", async () => {
  await withTestDb(async (db) => {
    const f = await notificationSmtpFixture(db);
    try {
      await enqueueSend(db, {
        accountId: f.accountId,
        idempotencyKey: f.notificationId,
        payload: {
          to: [f.runtime.emailAddress],
          subject: "Notification",
          html: "<p>Private notice</p>",
          visibility: "private",
          trackOpens: false,
          trackLinks: false,
          systemPurpose: {
            version: 1,
            kind: "notification",
            notificationId: f.notificationId,
            recipientUserId: f.other.id,
          },
        },
      });
      await runSendJob(
        db,
        { accountId: f.accountId, idempotencyKey: f.notificationId, signal: f.args.signal },
        f.deps,
      );
      expect(f.smtp.received).toHaveLength(0);
      expect(
        (
          await db.execute(
            sql`SELECT send_started_at FROM email_send_attempts WHERE account_id=${f.accountId} AND idempotency_key=${f.notificationId}`,
          )
        ).rows[0]?.send_started_at,
      ).toBeNull();
    } finally {
      await f.close();
    }
  });
});
