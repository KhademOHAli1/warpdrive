import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { processSmtpSendAttempt, repairSmtpReceipt } from "./smtpOutbox";
import { smtpOutboxFixture } from "./smtpOutbox.test-helpers";

type Fixture = Awaited<ReturnType<typeof smtpOutboxFixture>>;
type TestDb = Parameters<typeof smtpOutboxFixture>[0];

async function revokeOwner(db: TestDb, fixture: Fixture, state: "inactive" | "invited") {
  await db.execute(sql`UPDATE users SET
    is_active=${state !== "inactive"},invited_at=${state === "invited" ? new Date() : null}
    WHERE id=${fixture.owner.id}`);
}

for (const state of ["inactive", "invited"] as const) {
  for (const entry of ["repair", "replay"] as const) {
    it(`does not create a CRM copy for an ${state} owner through ${entry}`, async () => {
      await withTestDb(async (db) => {
        const fixture = await smtpOutboxFixture(db);
        try {
          await fixture.enqueue();
          await db.execute(sql`UPDATE email_send_attempts SET status='sent',
            send_started_at=now(),sent_at=now(),provider_message_id=${`smtp:${fixture.attemptId}`},
            delivery_outcome='{"state":"accepted","accepted":["customer@mail.test"]}'::jsonb
            WHERE id=${fixture.attemptId}`);
          await revokeOwner(db, fixture, state);
          const result =
            entry === "repair"
              ? await repairSmtpReceipt(db, fixture.args)
              : await processSmtpSendAttempt(db, fixture.args);
          expect(result).toMatchObject(
            entry === "repair"
              ? { ok: false, error: { id: "E_MAIL_007" } }
              : {
                  ok: true,
                  value: { status: "needs_review", deliveryOutcome: { state: "accepted" } },
                },
          );
          expect(
            (
              await db.execute(
                sql`SELECT id FROM email_messages WHERE account_id=${fixture.accountId}`,
              )
            ).rows,
          ).toHaveLength(0);
          expect(fixture.smtp.authenticationAttempts()).toBe(0);
          expect(fixture.imap.authenticationAttempts()).toBe(0);
        } finally {
          await fixture.close();
        }
      });
    });
  }

  it(`keeps acceptance but defers the CRM copy when its owner becomes ${state} after SMTP acknowledgment`, async () => {
    await withTestDb(async (db) => {
      const fixture = await smtpOutboxFixture(db);
      try {
        await fixture.enqueue();
        const runtime = {
          ...fixture.runtime,
          smtp: {
            ...fixture.runtime.smtp,
            sendRaw: async (args: Parameters<typeof fixture.runtime.smtp.sendRaw>[0]) => {
              const result = await fixture.runtime.smtp.sendRaw(args);
              expect(result.ok).toBe(true);
              await revokeOwner(db, fixture, state);
              return result;
            },
          },
        };
        expect(await processSmtpSendAttempt(db, { ...fixture.args, runtime })).toMatchObject({
          ok: true,
          value: { status: "needs_review", deliveryOutcome: { state: "accepted" } },
        });
        expect(fixture.smtp.received).toHaveLength(1);
        expect(
          (
            await db.execute(
              sql`SELECT id FROM email_messages WHERE account_id=${fixture.accountId}`,
            )
          ).rows,
        ).toHaveLength(0);
        expect(
          (
            await db.execute(
              sql`SELECT delivery_outcome->>'state' AS state FROM email_send_attempts WHERE id=${fixture.attemptId}`,
            )
          ).rows[0],
        ).toEqual({ state: "accepted" });
        expect(await processSmtpSendAttempt(db, fixture.args)).toMatchObject({
          ok: true,
          value: { status: "needs_review", deliveryOutcome: { state: "accepted" } },
        });
        expect(fixture.smtp.received).toHaveLength(1);
      } finally {
        await fixture.close();
      }
    });
  });
}
