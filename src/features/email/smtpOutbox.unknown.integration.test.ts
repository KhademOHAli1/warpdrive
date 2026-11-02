import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { processSmtpSendAttempt } from "./smtpOutbox";
import { smtpOutboxFixture } from "./smtpOutbox.test-helpers";

it("never resubmits an unknown receipt even if an older row lacks its submission timestamp", async () => {
  await withTestDb(async (db) => {
    const f = await smtpOutboxFixture(db);
    try {
      await f.enqueue();
      await db.execute(sql`UPDATE email_send_attempts SET status='failed',send_started_at=NULL,
        delivery_outcome='{"state":"unknown"}'::jsonb WHERE id=${f.attemptId}`);
      const result = await processSmtpSendAttempt(db, f.args);
      expect(result).toMatchObject({
        ok: true,
        value: { status: "needs_review", deliveryOutcome: { state: "unknown" } },
      });
      expect(f.smtp.received).toHaveLength(0);
    } finally {
      await f.close();
    }
  });
});
