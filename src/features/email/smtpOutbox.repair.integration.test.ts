import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { repairSmtpReceipt } from "./smtpOutbox";
import { smtpOutboxFixture } from "./smtpOutbox.test-helpers";

for (const state of ["accepted", "partial"] as const)
  it(`repairs an active owner's ${state} receipt after disconnect without credentials or network`, async () => {
    await withTestDb(async (db) => {
      const f = await smtpOutboxFixture(db);
      try {
        await f.enqueue();
        await db.execute(
          sql`UPDATE email_accounts SET status='disconnected',paused=true,connection_generation=2,credentials_enc=NULL WHERE id=${f.accountId}`,
        );
        await db.execute(sql`UPDATE email_send_attempts SET status=${state === "accepted" ? "sent" : "needs_review"}::email_send_status,
        send_started_at=now(),sent_at=now(),provider_message_id=${`smtp:${f.attemptId}`},
        delivery_outcome=${JSON.stringify({ state, accepted: ["customer@mail.test"], rejected: state === "partial" ? ["reject@mail.test"] : [] })}::jsonb
        WHERE id=${f.attemptId}`);
        const args = {
          accountId: f.accountId,
          idempotencyKey: f.idempotencyKey,
          signal: f.args.signal,
        };
        const result = await repairSmtpReceipt(db, args);
        expect(result).toMatchObject({
          ok: true,
          value: {
            status: state === "accepted" ? "sent" : "needs_review",
            messageId: expect.any(String),
            deliveryOutcome: { state },
          },
        });
        expect(await repairSmtpReceipt(db, args)).toEqual(result);
        expect(
          (await db.execute(sql`SELECT id FROM email_messages WHERE account_id=${f.accountId}`))
            .rows,
        ).toHaveLength(1);
        expect(f.smtp.authenticationAttempts()).toBe(0);
        expect(f.imap.authenticationAttempts()).toBe(0);
      } finally {
        await f.close();
      }
    });
  });

for (const mode of ["inactive_owner", "unknown_receipt"] as const)
  it(`does not repair ${mode} into an accepted CRM message`, async () => {
    await withTestDb(async (db) => {
      const f = await smtpOutboxFixture(db);
      try {
        await f.enqueue();
        await db.execute(sql`UPDATE email_send_attempts SET send_started_at=now(),provider_message_id=${`smtp:${f.attemptId}`},
        delivery_outcome=${JSON.stringify({ state: mode === "unknown_receipt" ? "unknown" : "accepted" })}::jsonb WHERE id=${f.attemptId}`);
        if (mode === "inactive_owner")
          await db.execute(sql`UPDATE users SET is_active=false WHERE id=${f.owner.id}`);
        expect(
          await repairSmtpReceipt(db, {
            accountId: f.accountId,
            idempotencyKey: f.idempotencyKey,
            signal: f.args.signal,
          }),
        ).toMatchObject({ ok: false });
        expect(
          (await db.execute(sql`SELECT id FROM email_messages WHERE account_id=${f.accountId}`))
            .rows,
        ).toHaveLength(0);
        expect(f.smtp.authenticationAttempts()).toBe(0);
      } finally {
        await f.close();
      }
    });
  });
