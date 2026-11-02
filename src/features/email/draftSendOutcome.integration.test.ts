import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { actorOf } from "./draft.test-helpers";
import { listDrafts, saveDraft } from "./draftRepo";
import { processSmtpSendAttempt } from "./smtpOutbox";
import { smtpOutboxFixture } from "./smtpOutbox.test-helpers";

it("restores a draft's accepted or uncertain send intent without exposing provider internals", async () => {
  await withTestDb(async (db) => {
    const f = await smtpOutboxFixture(db);
    try {
      const actor = actorOf(f.owner.id);
      const draft = await saveDraft(
        db,
        {
          actor,
          draft: {
            accountId: f.accountId,
            subject: "پیشنهاد",
            bodyHtml: "<p>Grüße</p>",
            toEmails: ["customer@mail.test"],
            ccEmails: [],
            sendIntentId: f.idempotencyKey,
          },
        },
        f.args.signal,
      );
      expect(draft.ok).toBe(true);
      await f.enqueue();
      const sent = await processSmtpSendAttempt(db, f.args);
      expect(sent.ok).toBe(true);
      const accepted = (await listDrafts(db, actor, f.args.signal))[0];
      expect(accepted?.sendOutcome).toMatchObject({
        status: "sent",
        deliveryOutcome: { state: "accepted" },
        providerMessageId: `smtp:${f.attemptId}`,
      });
      await db.execute(
        sql`UPDATE email_send_attempts SET status='needs_review',delivery_outcome=${JSON.stringify({ state: "unknown", preparedAttachments: [{ objectKey: "private-snapshot-key", sha256: "private-hash" }] })}::jsonb WHERE id=${f.attemptId}`,
      );
      const unknown = (await listDrafts(db, actor, f.args.signal))[0];
      expect(unknown?.sendOutcome).toMatchObject({
        status: "needs_review",
        deliveryOutcome: { state: "unknown" },
      });
      expect(JSON.stringify(unknown?.sendOutcome)).not.toMatch(
        /private-snapshot-key|private-hash|preparedAttachments|password/i,
      );
      expect(f.smtp.received).toHaveLength(1);
    } finally {
      await f.close();
    }
  });
});
