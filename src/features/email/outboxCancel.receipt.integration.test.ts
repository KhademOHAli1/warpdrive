import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { actorOf } from "./draft.test-helpers";
import { cancelOutbox } from "./outboxCancel";
import { smtpOutboxFixture } from "./smtpOutbox.test-helpers";

it("refuses to cancel uncertain SMTP effects and permits editing only a definite unsubmitted rejection", async () => {
  await withTestDb(async (db) => {
    const f = await smtpOutboxFixture(db);
    try {
      await f.enqueue();
      const args = { actor: actorOf(f.owner.id), attemptId: f.attemptId };
      await db.execute(
        sql`UPDATE email_send_attempts SET status='needs_review',send_started_at=now(),delivery_outcome='{"state":"unknown"}'::jsonb WHERE id=${f.attemptId}`,
      );
      expect((await cancelOutbox(db, args, f.args.signal)).ok).toBe(false);
      await db.execute(
        sql`UPDATE email_send_attempts SET send_started_at=NULL,delivery_outcome='{"state":"partial","accepted":["customer@mail.test"]}'::jsonb WHERE id=${f.attemptId}`,
      );
      expect((await cancelOutbox(db, args, f.args.signal)).ok).toBe(false);
      await db.execute(
        sql`UPDATE email_send_attempts SET status='failed',delivery_outcome='{"state":"rejected"}'::jsonb WHERE id=${f.attemptId}`,
      );
      expect((await cancelOutbox(db, args, f.args.signal)).ok).toBe(true);
    } finally {
      await f.close();
    }
  });
});
