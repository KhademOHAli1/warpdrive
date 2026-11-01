import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { deliverySignal, seedDeliveryAttempt } from "./deliveryObservation.test-helpers";
import { readAttemptDeliveryReports, readSourceDeliveryReports } from "./deliveryObservationReads";
import { reviewDeliveryReport } from "./deliveryObservationReview";
import { seedObservedDelivery } from "./deliveryObservationReview.test-helpers";

it("retains the latest review revision after target purge without resurrecting an older association", async () => {
  await withTestDb(async (db) => {
    const f = await seedObservedDelivery(db);
    expect(
      (await reviewDeliveryReport(db, f.owner.context, f.association, deliverySignal())).ok,
    ).toBe(true);
    const replacement = await seedDeliveryAttempt(db, f.accountId);
    expect(
      await reviewDeliveryReport(
        db,
        f.owner.context,
        {
          ...f.association,
          expectedRevision: 1,
          target: { attemptId: replacement.attemptId, recipient: f.association.target.recipient },
        },
        deliverySignal(),
      ),
    ).toMatchObject({ ok: true, value: { revision: 2 } });
    const historySql = sql`SELECT revision,attempt_id,recipient_snapshot,attempt_snapshot_hash
      FROM email_delivery_reviews WHERE report_id=${f.reportId} ORDER BY revision`;
    const before = (await db.execute(historySql)).rows;
    expect(before).toHaveLength(2);
    expect(before[1]?.attempt_id).toBe(replacement.attemptId);

    const deleted = await db.execute(sql`DELETE FROM email_send_attempts
      WHERE id=${replacement.attemptId} RETURNING id`);
    expect(deleted.rows).toHaveLength(1);
    expect((await db.execute(historySql)).rows).toEqual(
      before.map((row) => (row.revision === 2 ? { ...row, attempt_id: null } : row)),
    );
    expect(
      await readAttemptDeliveryReports(
        db,
        {
          actor: f.actor,
          attemptId: f.attempt.attemptId,
        },
        deliverySignal(),
      ),
    ).toEqual({ ok: true, value: [] });
    const source = await readSourceDeliveryReports(
      db,
      {
        actor: f.actor,
        sourceMessageId: f.source.messageId,
      },
      deliverySignal(),
    );
    expect(source).toMatchObject({
      ok: true,
      value: [
        {
          recipients: [
            {
              review: {
                revision: 2,
                decision: "unavailable",
                target: null,
              },
            },
          ],
        },
      ],
    });
    expect(JSON.stringify(source)).not.toContain(replacement.attemptId);

    expect(
      await reviewDeliveryReport(
        db,
        f.owner.context,
        {
          ...f.association,
          expectedRevision: 1,
        },
        deliverySignal(),
      ),
    ).toEqual({ ok: false, error: "conflict" });
    expect((await db.execute(historySql)).rows).toHaveLength(2);
    expect(
      await reviewDeliveryReport(
        db,
        f.owner.context,
        {
          ...f.association,
          expectedRevision: 2,
        },
        deliverySignal(),
      ),
    ).toMatchObject({ ok: true, value: { revision: 3 } });
  });
});
