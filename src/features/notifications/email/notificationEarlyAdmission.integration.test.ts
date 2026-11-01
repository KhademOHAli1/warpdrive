import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { claim } from "@/features/email/outboxClaim";
import { prepareNotificationEmail } from "./notificationBinding";
import { dispatchNotificationEmail } from "./notificationDispatch";
import { notificationSmtpFixture } from "./notificationDispatch.test-helpers";

const REASONS = {
  opt_out: "preference_disabled",
  visibility: "entity_unavailable",
  invited: "recipient_unavailable",
  inactive: "recipient_unavailable",
} as const;

it("does not grant an outbox claim for a durably suppressed notification", async () => {
  await withTestDb(async (db) => {
    const f = await notificationSmtpFixture(db);
    try {
      const prepared = await prepareNotificationEmail(db, f.input);
      expect(prepared).toMatchObject({ ok: true, value: { status: "prepared" } });
      if (!prepared.ok || prepared.value.status !== "prepared") return;
      await db.execute(sql`UPDATE email_send_attempts SET notification_suppressed_at=now(),
        notification_suppression_reason='preference_disabled' WHERE id=${prepared.value.attemptId}`);
      expect(await claim(db, prepared.value.attemptId, f.args.signal)).toBeNull();
      expect(f.smtp.authenticationAttempts()).toBe(0);
    } finally {
      await f.close();
    }
  });
});

for (const kind of ["opt_out", "visibility", "invited", "inactive"] as const) {
  it(`durably suppresses a bound notification before opening SMTP after ${kind}`, async () => {
    await withTestDb(async (db) => {
      const f = await notificationSmtpFixture(db);
      try {
        const prepared = await prepareNotificationEmail(db, f.input);
        expect(prepared).toMatchObject({ ok: true, value: { status: "prepared" } });
        if (!prepared.ok || prepared.value.status !== "prepared") return;
        await f.revoke(kind);
        const delivered = await dispatchNotificationEmail(db, f.input, f.deps);
        expect.soft(delivered).toMatchObject({ ok: true, value: { status: "suppressed" } });
        expect.soft(f.smtp.authenticationAttempts()).toBe(0);
        expect(f.smtp.received).toHaveLength(0);
        const row = (
          await db.execute(sql`SELECT notification_suppressed_at,
          notification_suppression_reason,send_started_at FROM email_send_attempts
          WHERE id=${prepared.value.attemptId}`)
        ).rows[0];
        expect(row).toMatchObject({
          notification_suppression_reason: REASONS[kind],
          send_started_at: null,
        });
        expect(row?.notification_suppressed_at).not.toBeNull();
        expect(
          (
            await db.execute(sql`SELECT id FROM email_messages
          WHERE account_id=${prepared.value.accountId} AND direction='outbound'`)
          ).rows,
        ).toHaveLength(0);
      } finally {
        await f.close();
      }
    });
  });
}
