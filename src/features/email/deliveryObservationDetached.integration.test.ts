import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import {
  deliverySignal,
  reportedRecipient,
  submissionFacts,
} from "./deliveryObservation.test-helpers";
import {
  expectedDetachedReport,
  withActualDetachedSend,
} from "./deliveryObservationDetached.test-helpers";
import { createDeliveryObservationHttp } from "./deliveryObservationHttp";
import {
  seedCanonicalNotificationMessageRef,
  seedMessageRefFixture,
} from "./deliveryObservationMessageRefs.test-helpers";
import {
  listDeliveryReviewTargets,
  readAttemptDeliveryReports,
  readSourceDeliveryReports,
} from "./deliveryObservationReads";
import { reviewDeliveryReport } from "./deliveryObservationReview";

describe("detached delivery attempts require a live authoritative owner-only copy", () => {
  it("allows ordinary native review of a private canonical Gmail copy without send capability", async () => {
    await withTestDb(async (db) => {
      const f = await seedCanonicalNotificationMessageRef(db);
      const before = await submissionFacts(db, f.attempt.attemptId);
      const history = (
        await db.execute(sql`SELECT to_jsonb(r) AS row FROM email_delivery_reviews r
        WHERE report_id=${f.reportId} ORDER BY revision`)
      ).rows;
      const result = await reviewDeliveryReport(
        db,
        f.owner.context,
        {
          reportId: f.reportId,
          recipientIndex: 0,
          expectedRevision: 1,
          confirmUnverified: true,
          decision: "associate",
          target: { attemptId: f.attempt.attemptId, recipient: reportedRecipient },
        },
        deliverySignal(),
      );
      expect(result).toMatchObject({
        ok: true,
        value: {
          revision: 2,
          decision: "associated",
          target: { attemptId: f.attempt.attemptId, recipient: reportedRecipient, kind: "to" },
        },
      });
      expect(
        (
          await db.execute(sql`SELECT to_jsonb(r) AS row FROM email_delivery_reviews r
        WHERE report_id=${f.reportId} ORDER BY revision`)
        ).rows[0],
      ).toEqual(history[0]);
      expect(await submissionFacts(db, f.attempt.attemptId)).toEqual(before);
    });
  });

  it.each(["source", "attempt"] as const)(
    "reads the real current canonical association by %s",
    async (selector) => {
      await withTestDb(async (db) => {
        const f = await seedCanonicalNotificationMessageRef(db);
        const before = await submissionFacts(db, f.attempt.attemptId);
        const result =
          selector === "source"
            ? await readSourceDeliveryReports(
                db,
                { actor: f.actor, sourceMessageId: f.source.messageId },
                deliverySignal(),
              )
            : await readAttemptDeliveryReports(
                db,
                { actor: f.actor, attemptId: f.attempt.attemptId },
                deliverySignal(),
              );
        expect(result).toMatchObject(expectedDetachedReport(f.reportId, f.attempt.attemptId, 1));
        expect(await submissionFacts(db, f.attempt.attemptId)).toEqual(before);
      });
    },
  );

  it("includes the live canonical copy in the owner's review picker", async () => {
    await withTestDb(async (db) => {
      const f = await seedCanonicalNotificationMessageRef(db);
      expect(f.reportId).not.toBeNull();
      if (f.reportId === null) return;
      const result = await listDeliveryReviewTargets(
        db,
        { actor: f.actor, reportId: f.reportId },
        deliverySignal(),
      );
      expect(result).toMatchObject({
        ok: true,
        value: [
          {
            attemptId: f.attempt.attemptId,
            recipients: expect.arrayContaining([{ address: reportedRecipient, kind: "to" }]),
          },
        ],
      });
    });
  });

  it("serves a canonical attempt report through the actual native HTTP boundary", async () => {
    await withTestDb(async (db) => {
      const f = await seedCanonicalNotificationMessageRef(db);
      const response = await createDeliveryObservationHttp(db)(
        new Request(
          `${f.owner.origin}/api/email/delivery-reports?attemptId=${f.attempt.attemptId}`,
          { headers: f.owner.headers },
        ),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject(
        expectedDetachedReport(f.reportId, f.attempt.attemptId, 1),
      );
    });
  });

  it.each(["imap_smtp", "gmail"] as const)(
    "reviews and reads a real fresh-compose %s send with NULL attempt thread",
    async (provider) => {
      await withTestDb(async (db) =>
        withActualDetachedSend(db, provider, async (f) => {
          const before = await submissionFacts(db, f.attemptId);
          const reviewed = await reviewDeliveryReport(
            db,
            f.owner.context,
            {
              reportId: f.reportId,
              recipientIndex: 0,
              expectedRevision: 0,
              confirmUnverified: true,
              decision: "associate",
              target: { attemptId: f.attemptId, recipient: reportedRecipient },
            },
            deliverySignal(),
          );
          expect(reviewed).toMatchObject({
            ok: true,
            value: { revision: 1, decision: "associated" },
          });
          expect(
            await readAttemptDeliveryReports(
              db,
              { actor: f.actor, attemptId: f.attemptId },
              deliverySignal(),
            ),
          ).toMatchObject(expectedDetachedReport(f.reportId, f.attemptId, 1));
          expect(await submissionFacts(db, f.attemptId)).toEqual(before);
          expect(f.sendCount()).toBe(1);
        }),
      );
    },
  );

  it.each(["copy_deleted", "thread_deleted", "copy_trashed", "foreign_copy"] as const)(
    "does not revive a detached association from unavailable evidence: %s",
    async (state) => {
      await withTestDb(async (db) => {
        const f = await seedMessageRefFixture(db);
        const before = (
          await db.execute(sql`SELECT to_jsonb(r) AS row FROM email_delivery_reviews r
          WHERE report_id=${f.reportId} ORDER BY revision`)
        ).rows;
        await db.execute(
          sql`UPDATE email_send_attempts SET thread_id=NULL WHERE id=${f.attempt.attemptId}`,
        );
        if (state === "copy_deleted")
          await db.execute(sql`DELETE FROM email_messages WHERE id=${f.attempt.messageId}`);
        if (state === "thread_deleted")
          await db.execute(sql`DELETE FROM email_threads WHERE id=${f.attempt.threadId}`);
        if (state === "copy_trashed")
          await db.execute(
            sql`UPDATE email_threads SET trashed_at=now() WHERE id=${f.attempt.threadId}`,
          );
        if (state === "foreign_copy") {
          const accountId = randomUUID();
          const threadId = randomUUID();
          await db.execute(sql`INSERT INTO email_accounts(id,user_id,email_address,provider)
            VALUES(${accountId},${f.actor.id},${`${accountId}@example.test`},'imap_smtp')`);
          await db.execute(sql`INSERT INTO email_threads(id,account_id,provider_thread_id)
            VALUES(${threadId},${accountId},'foreign-detached-copy')`);
          await db.execute(sql`UPDATE email_messages SET account_id=${accountId},thread_id=${threadId}
            WHERE id=${f.attempt.messageId}`);
        }
        const source = await readSourceDeliveryReports(
          db,
          { actor: f.actor, sourceMessageId: f.source.messageId },
          deliverySignal(),
        );
        expect(source).toMatchObject({
          ok: true,
          value: [
            {
              recipients: [
                {
                  review: {
                    revision: 1,
                    decision: "unavailable",
                    target: null,
                  },
                },
              ],
            },
          ],
        });
        expect(
          await readAttemptDeliveryReports(
            db,
            { actor: f.actor, attemptId: f.attempt.attemptId },
            deliverySignal(),
          ),
        ).toEqual({ ok: false, error: "not_found" });
        expect(
          await reviewDeliveryReport(
            db,
            f.owner.context,
            {
              reportId: f.reportId,
              recipientIndex: 0,
              expectedRevision: 1,
              confirmUnverified: true,
              decision: "associate",
              target: { attemptId: f.attempt.attemptId, recipient: reportedRecipient },
            },
            deliverySignal(),
          ),
        ).toEqual({ ok: false, error: "not_found" });
        expect(
          (
            await db.execute(sql`SELECT to_jsonb(r) AS row FROM email_delivery_reviews r
          WHERE report_id=${f.reportId} ORDER BY revision`)
          ).rows,
        ).toEqual(before);
        expect(JSON.stringify(source)).not.toContain(f.attempt.attemptId);
      });
    },
  );

  it("does not bypass a trashed nonnull bound thread through an alternate readable copy", async () => {
    await withTestDb(async (db) => {
      const f = await seedMessageRefFixture(db);
      const threadId = randomUUID();
      await db.execute(sql`INSERT INTO email_threads(id,account_id,provider_thread_id)
        VALUES(${threadId},${f.accountId},'alternate-detached-copy')`);
      await db.execute(
        sql`UPDATE email_messages SET thread_id=${threadId} WHERE id=${f.attempt.messageId}`,
      );
      await db.execute(
        sql`UPDATE email_threads SET trashed_at=now() WHERE id=${f.attempt.threadId}`,
      );
      expect(
        await readAttemptDeliveryReports(
          db,
          { actor: f.actor, attemptId: f.attempt.attemptId },
          deliverySignal(),
        ),
      ).toEqual({ ok: false, error: "not_found" });
      expect(
        await readSourceDeliveryReports(
          db,
          { actor: f.actor, sourceMessageId: f.source.messageId },
          deliverySignal(),
        ),
      ).toMatchObject({
        ok: true,
        value: [
          {
            recipients: [
              {
                review: {
                  revision: 1,
                  decision: "unavailable",
                  target: null,
                },
              },
            ],
          },
        ],
      });
    });
  });
});
