import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PoolClient } from "pg";
import { expect, it } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import * as schema from "@/db/schema";
import { stampGmailSend } from "@/features/email/gmailSendFence";
import { claim } from "@/features/email/outboxClaim";
import {
  claimSmtpAttempt,
  loadSmtpAttempt,
  stampSmtpSubmission,
} from "@/features/email/smtpOutboxRepo";
import { makeTestDb } from "@/test/db";
import {
  enqueueRetainedNotification,
  type NotificationSmtpFixture,
  notificationSmtpFixture,
} from "./notificationDispatch.test-helpers";
import {
  disposeNotificationResources,
  waitForNotificationWaiters,
} from "./notificationPg.test-helpers";

async function releaseConnection(client: PoolClient | undefined, statement: string) {
  if (client === undefined) return;
  try {
    await client.query(statement);
  } finally {
    client.release();
  }
}

for (const provider of ["imap_smtp", "gmail"] as const)
  for (const revoked of [false, true])
    it(`${provider} opens its outer stamp as READ COMMITTED before the first query (revoked=${revoked})`, async () => {
      const h = await makeTestDb();
      let f: NotificationSmtpFixture | undefined;
      let controller: PoolClient | undefined;
      let repeatedRead: PoolClient | undefined;
      let pending: Promise<boolean> | undefined;
      try {
        f = await notificationSmtpFixture(h.db);
        await h.db.execute(
          sql`UPDATE email_accounts SET provider=${provider} WHERE id=${f.accountId}`,
        );
        const queued = await enqueueRetainedNotification(h.db, f);
        expect(queued.ok).toBe(true);
        if (!queued.ok) throw queued.error;
        const token = await (provider === "gmail" ? claim : claimSmtpAttempt)(
          h.db,
          queued.value.attemptId,
          f.args.signal,
        );
        if (token === null)
          throw new AppError(ERROR_IDS.DB_INVARIANT, "Notification fixture claim missing");
        await h.db.execute(
          sql`CREATE TABLE notification_fixture_stamp_audit (isolation text NOT NULL)`,
        );
        await h.db.execute(sql`CREATE FUNCTION notification_fixture_stamp_audit() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN IF OLD.send_started_at IS NULL AND NEW.send_started_at IS NOT NULL THEN
            INSERT INTO notification_fixture_stamp_audit VALUES (current_setting('transaction_isolation'));
          END IF; RETURN NEW; END $$`);
        await h.db.execute(sql`CREATE TRIGGER notification_fixture_stamp_audit BEFORE UPDATE OF send_started_at ON email_send_attempts
          FOR EACH ROW EXECUTE FUNCTION notification_fixture_stamp_audit()`);
        repeatedRead = await h.pool.connect();
        // This connection alone simulates an operator default, never ALTER DATABASE or global env.
        await repeatedRead.query("SET SESSION default_transaction_isolation='repeatable read'");
        expect(
          (await repeatedRead.query("SHOW default_transaction_isolation")).rows[0]
            ?.default_transaction_isolation,
        ).toBe("repeatable read");
        const stampDb = drizzle(repeatedRead, { schema });
        controller = await h.pool.connect();
        await controller.query("BEGIN");
        await controller.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [f.owner.id]);
        if (provider === "gmail") {
          pending = stampGmailSend(stampDb, queued.value.attemptId, token, f.args.signal, 1);
        } else {
          const attempt = await loadSmtpAttempt(h.db, f.accountId, f.notificationId, f.args.signal);
          if (attempt === undefined)
            throw new AppError(ERROR_IDS.DB_INVARIANT, "Notification fixture attempt missing");
          pending = stampSmtpSubmission(stampDb, {
            attempt,
            runtime: f.runtime,
            token,
            receipt: { state: "unknown" },
            signal: f.args.signal,
          });
        }
        void pending.catch(() => undefined);
        // The outer transaction already queried its account pointer/advisory lock before waiting.
        await waitForNotificationWaiters(controller, 1, f.args.signal);
        if (revoked)
          await controller.query(
            "UPDATE notification_preferences SET email=false WHERE user_id=$1 AND type='activity_reminder'",
            [f.owner.id],
          );
        await controller.query("COMMIT");
        expect(await pending).toBe(!revoked);
        expect(
          (await h.db.execute(sql`SELECT isolation FROM notification_fixture_stamp_audit`)).rows,
        ).toEqual(revoked ? [] : [{ isolation: "read committed" }]);
        expect(f.smtp.received).toHaveLength(0);
      } finally {
        await disposeNotificationResources(
          () => releaseConnection(controller, "ROLLBACK"),
          () => pending ?? Promise.resolve(),
          () => releaseConnection(repeatedRead, "RESET default_transaction_isolation"),
          () => f?.close() ?? Promise.resolve(),
          () => h.close(),
        );
      }
    });
