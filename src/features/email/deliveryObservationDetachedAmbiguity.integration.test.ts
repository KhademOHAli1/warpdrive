import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import {
  deliverySignal,
  seedDeliveryAttempt,
  submissionFacts,
} from "./deliveryObservation.test-helpers";
import { seedMessageRefFixture } from "./deliveryObservationMessageRefs.test-helpers";
import {
  listDeliveryReviewTargets,
  readAttemptDeliveryReports,
  readSourceDeliveryReports,
} from "./deliveryObservationReads";
import { reviewDeliveryReport } from "./deliveryObservationReview";

it("rejects a detached Gmail copy claimed by competing submitted attempts regardless of requested-ID filtering", async () => {
  await withTestDb(async (db) => {
    const f = await seedMessageRefFixture(db, "gmail");
    expect(f.reportId).not.toBeNull();
    if (f.reportId === null) return;
    await db.execute(
      sql`UPDATE email_send_attempts SET thread_id=NULL WHERE id=${f.attempt.attemptId}`,
    );
    const expectAssociated = async () => {
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
            recipients: [
              {
                review: {
                  revision: 1,
                  decision: "associated",
                  target: { attemptId: f.attempt.attemptId },
                },
              },
            ],
          },
        ],
      });
    };
    await expectAssociated();

    const competitor = await seedDeliveryAttempt(db, f.accountId);
    await db.execute(sql`UPDATE email_send_attempts SET thread_id=NULL,
      provider_message_id=${f.providerId},gmail_message_id=${f.providerId},payload_prepared=false
      WHERE id=${competitor.attemptId}`);
    await expectAssociated();
    await db.execute(sql`UPDATE email_send_attempts SET payload_prepared=true,send_started_at=NULL
      WHERE id=${competitor.attemptId}`);
    await expectAssociated();

    await db.execute(
      sql`UPDATE email_send_attempts SET send_started_at=now() WHERE id=${competitor.attemptId}`,
    );
    const primaryBefore = await submissionFacts(db, f.attempt.attemptId);
    const competitorBefore = await submissionFacts(db, competitor.attemptId);
    expect(primaryBefore).toMatchObject({
      payload_prepared: true,
      send_started_at: expect.anything(),
    });
    expect(competitorBefore).toMatchObject({
      payload_prepared: true,
      send_started_at: expect.anything(),
    });
    const historySql = sql`SELECT to_jsonb(r) AS row FROM email_delivery_reviews r
      WHERE report_id=${f.reportId} ORDER BY revision`;
    const historyBefore = (await db.execute(historySql)).rows;

    const source = await readSourceDeliveryReports(
      db,
      { actor: f.actor, sourceMessageId: f.source.messageId },
      deliverySignal(),
    );
    expect.soft(source).toMatchObject({
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
    expect.soft(JSON.stringify(source)).not.toContain(f.attempt.attemptId);
    expect
      .soft(
        await readAttemptDeliveryReports(
          db,
          { actor: f.actor, attemptId: f.attempt.attemptId },
          deliverySignal(),
        ),
      )
      .toEqual({ ok: false, error: "not_found" });
    expect
      .soft(
        await readAttemptDeliveryReports(
          db,
          { actor: f.actor, attemptId: competitor.attemptId },
          deliverySignal(),
        ),
      )
      .toEqual({ ok: false, error: "not_found" });
    expect
      .soft(
        await listDeliveryReviewTargets(
          db,
          { actor: f.actor, reportId: f.reportId },
          deliverySignal(),
        ),
      )
      .toEqual({ ok: true, value: [] });
    expect
      .soft(
        await reviewDeliveryReport(
          db,
          f.owner.context,
          {
            reportId: f.reportId,
            recipientIndex: 0,
            expectedRevision: 1,
            confirmUnverified: true,
            decision: "associate",
            target: { attemptId: f.attempt.attemptId, recipient: f.attempt.payload.to[0] },
          },
          deliverySignal(),
        ),
      )
      .toEqual({ ok: false, error: "not_found" });
    expect.soft((await db.execute(historySql)).rows).toEqual(historyBefore);
    expect.soft(await submissionFacts(db, f.attempt.attemptId)).toEqual(primaryBefore);
    expect.soft(await submissionFacts(db, competitor.attemptId)).toEqual(competitorBefore);
  });
});
