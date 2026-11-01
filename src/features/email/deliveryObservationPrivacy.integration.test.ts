import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { deliveryActor, deliverySignal, hiddenRecipient } from "./deliveryObservation.test-helpers";
import {
  listDeliveryReviewTargets,
  readAttemptDeliveryReports,
  readSourceDeliveryReports,
} from "./deliveryObservationReads";
import { reviewDeliveryReport } from "./deliveryObservationReview";
import { seedObservedDelivery } from "./deliveryObservationReview.test-helpers";
import { getThread } from "./emailReads";

describe("delivery observations never broaden mailbox visibility", () => {
  it("shows the owner bounded unverified observations and only explicit reviewed associations", async () => {
    await withTestDb(async (db) => {
      const f = await seedObservedDelivery(db);
      const source = await readSourceDeliveryReports(
        db,
        { actor: f.actor, sourceMessageId: f.source.messageId },
        deliverySignal(),
      );
      expect(source).toMatchObject({
        ok: true,
        value: [
          {
            id: f.reportId,
            trust: "unverified",
            requiresReview: true,
            recipients: [{ review: { revision: 0, decision: "unreviewed", target: null } }],
          },
        ],
      });
      expect(
        await readAttemptDeliveryReports(
          db,
          { actor: f.actor, attemptId: f.attempt.attemptId },
          deliverySignal(),
        ),
      ).toEqual({ ok: true, value: [] });
      expect(
        (await reviewDeliveryReport(db, f.owner.context, f.association, deliverySignal())).ok,
      ).toBe(true);
      expect(
        await readAttemptDeliveryReports(
          db,
          { actor: f.actor, attemptId: f.attempt.attemptId },
          deliverySignal(),
        ),
      ).toMatchObject({
        ok: true,
        value: [
          {
            id: f.reportId,
            trust: "unverified",
            recipients: [
              {
                review: {
                  revision: 1,
                  decision: "associated",
                  target: {
                    attemptId: f.attempt.attemptId,
                    recipient: f.association.target.recipient,
                  },
                },
              },
            ],
          },
        ],
      });
    });
  });

  it.each([false, true])(
    "reveals no report metadata, counts, or BCC to a shared viewer (admin=%s)",
    async (isAdmin) => {
      await withTestDb(async (db) => {
        const f = await seedObservedDelivery(db);
        const viewer = await seedUser(db, { isAdmin });
        const actor = deliveryActor(viewer.id, isAdmin);
        const person = (
          await db.execute(sql`INSERT INTO persons(name,owner_id,visibility_level)
        VALUES('Shared customer',${f.owner.user.id},'all') RETURNING id`)
        ).rows[0];
        await db.execute(sql`UPDATE email_threads SET visibility='shared',person_id=${person?.id}
        WHERE id IN (${f.source.threadId},${f.attempt.threadId})`);
        expect(
          (
            await getThread(
              db,
              { actor, threadId: f.attempt.threadId, allowRemote: false },
              deliverySignal(),
            )
          ).ok,
        ).toBe(true);
        expect(
          (
            await reviewDeliveryReport(
              db,
              f.owner.context,
              {
                ...f.association,
                target: { attemptId: f.attempt.attemptId, recipient: hiddenRecipient },
              },
              deliverySignal(),
            )
          ).ok,
        ).toBe(true);
        for (const result of [
          await readSourceDeliveryReports(
            db,
            { actor, sourceMessageId: f.source.messageId },
            deliverySignal(),
          ),
          await readAttemptDeliveryReports(
            db,
            { actor, attemptId: f.attempt.attemptId },
            deliverySignal(),
          ),
          await listDeliveryReviewTargets(db, { actor, reportId: f.reportId }, deliverySignal()),
        ]) {
          expect(result).toEqual({ ok: false, error: "not_found" });
          expect(JSON.stringify(result)).not.toMatch(
            /private-bcc|Empfänger|نشانی|recipient|count|revision/u,
          );
        }
      });
    },
  );

  it("rechecks source readability on every outbound report read", async () => {
    await withTestDb(async (db) => {
      const f = await seedObservedDelivery(db);
      expect(
        (await reviewDeliveryReport(db, f.owner.context, f.association, deliverySignal())).ok,
      ).toBe(true);
      await db.execute(
        sql`UPDATE email_threads SET trashed_at=now() WHERE id=${f.source.threadId}`,
      );
      expect(
        await readSourceDeliveryReports(
          db,
          { actor: f.actor, sourceMessageId: f.source.messageId },
          deliverySignal(),
        ),
      ).toEqual({ ok: false, error: "not_found" });
      expect(
        await readAttemptDeliveryReports(
          db,
          { actor: f.actor, attemptId: f.attempt.attemptId },
          deliverySignal(),
        ),
      ).toEqual({ ok: true, value: [] });
    });
  });

  it("does not project a saved association after its outbound thread becomes unreadable", async () => {
    await withTestDb(async (db) => {
      const f = await seedObservedDelivery(db);
      expect(
        (await reviewDeliveryReport(db, f.owner.context, f.association, deliverySignal())).ok,
      ).toBe(true);
      await db.execute(
        sql`UPDATE email_threads SET trashed_at=now() WHERE id=${f.attempt.threadId}`,
      );
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
      expect(JSON.stringify(source)).not.toContain(f.attempt.attemptId);
      expect(JSON.stringify(source)).not.toContain(hiddenRecipient);
    });
  });

  it("does not trust a cached AuthUser after the owner has been suspended", async () => {
    await withTestDb(async (db) => {
      const f = await seedObservedDelivery(db);
      await db.execute(sql`UPDATE users SET is_active=false WHERE id=${f.actor.id}`);
      expect(
        await readSourceDeliveryReports(
          db,
          { actor: f.actor, sourceMessageId: f.source.messageId },
          deliverySignal(),
        ),
      ).toEqual({ ok: false, error: "not_found" });
      expect(
        await listDeliveryReviewTargets(
          db,
          { actor: f.actor, reportId: f.reportId },
          deliverySignal(),
        ),
      ).toEqual({ ok: false, error: "not_found" });
    });
  });

  it("retains the audit snapshot but suppresses an association if its immutable send snapshot was changed", async () => {
    await withTestDb(async (db) => {
      const f = await seedObservedDelivery(db);
      expect(
        (await reviewDeliveryReport(db, f.owner.context, f.association, deliverySignal())).ok,
      ).toBe(true);
      const before = (await db.execute(sql`SELECT recipient_snapshot FROM email_delivery_reviews`))
        .rows;
      await db.execute(sql`UPDATE email_send_attempts SET payload=jsonb_set(payload,'{subject}','"Different message"'::jsonb)
        WHERE id=${f.attempt.attemptId}`);
      expect(
        await readAttemptDeliveryReports(
          db,
          { actor: f.actor, attemptId: f.attempt.attemptId },
          deliverySignal(),
        ),
      ).toEqual({ ok: true, value: [] });
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
        (await db.execute(sql`SELECT recipient_snapshot FROM email_delivery_reviews`)).rows,
      ).toEqual(before);
    });
  });
});
