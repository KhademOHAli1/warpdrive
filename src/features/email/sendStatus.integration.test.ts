import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { readOwnedSendStatus } from "./sendStatus";
import { processSmtpSendAttempt } from "./smtpOutbox";
import { smtpOutboxFixture } from "./smtpOutbox.test-helpers";

it("checks retained receipts after disconnect without credentials, network dispatch or a different owner", async () => {
  await withTestDb(async (db) => {
    const f = await smtpOutboxFixture(db);
    try {
      await f.enqueue();
      const sent = await processSmtpSendAttempt(db, f.args);
      expect(sent.ok).toBe(true);
      await db.execute(sql`DELETE FROM email_messages WHERE account_id=${f.accountId}`);
      await db.execute(
        sql`UPDATE email_accounts SET status='disconnected',paused=true,credentials_enc=NULL,connection_generation=2 WHERE id=${f.accountId}`,
      );
      const args = {
        actorId: f.owner.id,
        accountId: f.accountId,
        idempotencyKey: f.idempotencyKey,
        signal: f.args.signal,
      };
      const repaired = await readOwnedSendStatus(db, args);
      expect(repaired).toMatchObject({
        ok: true,
        value: {
          outcome: {
            status: "sent",
            attemptId: f.attemptId,
            deliveryOutcome: { state: "accepted" },
          },
        },
      });
      expect(f.smtp.received).toHaveLength(1);
      await db.execute(
        sql`UPDATE email_send_attempts SET status='needs_review',delivery_outcome='{"state":"unknown","preparedAttachments":[{"objectKey":"private-only"}]}'::jsonb WHERE id=${f.attemptId}`,
      );
      const unknown = await readOwnedSendStatus(db, args);
      expect(unknown).toMatchObject({
        ok: true,
        value: { outcome: { status: "needs_review", deliveryOutcome: { state: "unknown" } } },
      });
      expect(JSON.stringify(unknown)).not.toContain("private-only");
      const stranger = await seedUser(db);
      expect(await readOwnedSendStatus(db, { ...args, actorId: stranger.id })).toEqual({
        ok: true,
        value: null,
      });
      await db.execute(sql`UPDATE users SET is_active=false WHERE id=${f.owner.id}`);
      expect(await readOwnedSendStatus(db, args)).toEqual({ ok: true, value: null });
    } finally {
      await f.close();
    }
  });
});
