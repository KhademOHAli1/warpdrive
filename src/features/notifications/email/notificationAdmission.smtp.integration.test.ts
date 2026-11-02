import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { enqueueSend } from "@/features/email/outbox";
import { runSendJob } from "@/features/email/worker";
import { notificationSmtpFixture } from "./notificationDispatch.test-helpers";

for (const kind of ["opt_out", "visibility", "invited", "inactive"] as const)
  it(`blocks a retained notification at native SMTP's final post-auth fence after ${kind}`, async () => {
    await withTestDb(async (db) => {
      const f = await notificationSmtpFixture(db);
      try {
        const enqueued = await enqueueSend(db, {
          accountId: f.accountId,
          idempotencyKey: f.notificationId,
          payload: {
            to: [f.runtime.emailAddress],
            subject: "Fixture notification",
            html: "<p>Private notice</p>",
            visibility: "private",
            trackOpens: false,
            trackLinks: false,
            systemPurpose: {
              version: 1,
              kind: "notification",
              notificationId: f.notificationId,
              recipientUserId: f.owner.id,
            },
          },
        });
        expect(enqueued.ok).toBe(true);
        let revoked = false;
        f.runtimes.set(f.accountId, {
          ...f.runtime,
          smtp: {
            ...f.runtime.smtp,
            sendRaw: (args) =>
              f.runtime.smtp.sendRaw({
                ...args,
                beforeSubmission: async (signal) => {
                  expect(f.smtp.authenticationAttempts()).toBe(1);
                  await f.revoke(kind);
                  revoked = true;
                  return args.beforeSubmission?.(signal) ?? true;
                },
              }),
          },
        });
        await runSendJob(
          db,
          { accountId: f.accountId, idempotencyKey: f.notificationId, signal: f.args.signal },
          f.deps,
        );
        expect(revoked).toBe(true);
        expect(f.smtp.received).toHaveLength(0);
        const row = (
          await db.execute(sql`SELECT send_started_at FROM email_send_attempts
          WHERE account_id=${f.accountId} AND idempotency_key=${f.notificationId}`)
        ).rows[0];
        expect(row?.send_started_at).toBeNull();
        expect(
          (await db.execute(sql`SELECT id FROM email_messages WHERE account_id=${f.accountId}`))
            .rows,
        ).toHaveLength(0);
      } finally {
        await f.close();
      }
    });
  });
