import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { readPrivateIntake, reviewPrivateIntake } from "./privateIntakeReview";
import {
  confirmPrivateReviewFixture,
  seedAcknowledgedPrivateReview,
} from "./privateIntakeReview.lifecycle.test-helpers";
import {
  privateReviewHistory,
  privateReviewMutableSnapshot,
  privateReviewProtectedSnapshot,
  privateReviewSignal,
  seedNativePrivateReview,
} from "./privateIntakeReview.test-helpers";

it("uses ledger CAS across actual ACK confirmation and attempt-purge gaps while retaining the latest review", async () => {
  await withTestDb(async (db) => {
    const signal = privateReviewSignal();
    const f = await seedAcknowledgedPrivateReview(db, signal);
    expect(await reviewPrivateIntake(db, f.owner.context, f.input, signal)).toMatchObject({
      ok: true,
      value: { revision: 1, decision: "dismiss" },
    });
    await confirmPrivateReviewFixture(db, f, signal);
    expect(await readPrivateIntake(db, f.owner.context, f.scope, signal)).toEqual({
      ok: true,
      value: {
        id: f.id,
        revision: 2,
        state: "confirmed_notification",
        contentState: "retained",
        decision: "dismiss",
      },
    });
    expect(
      await reviewPrivateIntake(db, f.owner.context, { ...f.input, expectedRevision: 1 }, signal),
    ).toEqual({ ok: false, error: "conflict" });
    await db.execute(sql`DELETE FROM email_send_attempts WHERE account_id=${f.accountId}
      AND idempotency_key=${f.notificationId}`);
    expect(await readPrivateIntake(db, f.owner.context, f.scope, signal)).toEqual({
      ok: true,
      value: {
        id: f.id,
        revision: 3,
        state: "confirmed_notification",
        contentState: "retained",
        decision: "dismiss",
      },
    });
    const before = await privateReviewProtectedSnapshot(db, f.accountId, signal);
    expect(
      await reviewPrivateIntake(db, f.owner.context, { ...f.input, expectedRevision: 2 }, signal),
    ).toEqual({ ok: false, error: "conflict" });
    expect(
      await reviewPrivateIntake(
        db,
        f.owner.context,
        { ...f.input, expectedRevision: 3, decision: "restore_private" },
        signal,
      ),
    ).toEqual({
      ok: true,
      value: {
        id: f.id,
        revision: 4,
        state: "confirmed_notification",
        contentState: "retained",
        decision: "restore_private",
      },
    });
    expect(await privateReviewHistory(db, f.id, signal)).toEqual([
      { revision: 1, decision: "dismiss", actor_id: f.ownerId },
      { revision: 4, decision: "restore_private", actor_id: f.ownerId },
    ]);
    expect(await privateReviewProtectedSnapshot(db, f.accountId, signal)).toEqual(before);
    expect(f.transport.gmail.raw).toHaveLength(1);
  });
});

it("restores only review attention for purged content even with a disconnected mailbox, without rehydration or mail authority", async () => {
  await withTestDb(async (db) => {
    const signal = privateReviewSignal();
    const f = await seedNativePrivateReview(db, signal);
    expect(
      await reviewPrivateIntake(db, f.owner.context, { ...f.input, decision: "dismiss" }, signal),
    ).toMatchObject({ ok: true, value: { revision: 1 } });
    await db.execute(
      sql`DELETE FROM email_messages WHERE id=${f.messageId} AND account_id=${f.accountId}`,
    );
    await db.execute(
      sql`UPDATE email_accounts SET status='disconnected',paused=true WHERE id=${f.accountId}`,
    );
    const before = await privateReviewProtectedSnapshot(db, f.accountId, signal);
    expect(await readPrivateIntake(db, f.owner.context, f.scope, signal)).toEqual({
      ok: true,
      value: {
        id: f.id,
        revision: 2,
        state: "unverified",
        contentState: "purged",
        decision: "dismiss",
      },
    });
    const stale = { ...f.input, decision: "restore_private" as const, expectedRevision: 1 };
    expect(await reviewPrivateIntake(db, f.owner.context, stale, signal)).toEqual({
      ok: false,
      error: "conflict",
    });
    expect(
      await reviewPrivateIntake(db, f.owner.context, { ...stale, expectedRevision: 2 }, signal),
    ).toEqual({
      ok: true,
      value: {
        id: f.id,
        revision: 3,
        state: "unverified",
        contentState: "purged",
        decision: "restore_private",
      },
    });
    expect(await privateReviewProtectedSnapshot(db, f.accountId, signal)).toEqual(before);
  });
});

it("rolls the ledger revision back when the following append-only history insert fails", async () => {
  await withTestDb(async (db) => {
    const signal = privateReviewSignal();
    const f = await seedNativePrivateReview(db, signal);
    await db.execute(sql`CREATE SEQUENCE private_review_insert_witness`);
    await db.execute(sql`CREATE FUNCTION private_review_test_failure() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN
        PERFORM nextval('private_review_insert_witness'::regclass);
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='disposable review insert failure'; END $$`);
    await db.execute(sql`CREATE TRIGGER zz_private_review_test_failure BEFORE INSERT ON email_private_intake_reviews
      FOR EACH ROW EXECUTE FUNCTION private_review_test_failure()`);
    try {
      const before = await privateReviewMutableSnapshot(db, f.id, signal);
      const evidence = await privateReviewProtectedSnapshot(db, f.accountId, signal);
      expect(
        (
          await db.execute(
            sql`SELECT last_value::text,is_called FROM private_review_insert_witness`,
          )
        ).rows,
      ).toEqual([{ last_value: "1", is_called: false }]);
      expect(await reviewPrivateIntake(db, f.owner.context, f.input, signal)).toEqual({
        ok: false,
        error: "unavailable",
      });
      // Sequence effects survive rollback: prove the exact INSERT/fault boundary
      // was reached, rather than accepting an unrelated early unavailable result.
      expect(
        (
          await db.execute(
            sql`SELECT last_value::text,is_called FROM private_review_insert_witness`,
          )
        ).rows,
      ).toEqual([{ last_value: "1", is_called: true }]);
      expect(await privateReviewMutableSnapshot(db, f.id, signal)).toEqual(before);
      expect(await privateReviewProtectedSnapshot(db, f.accountId, signal)).toEqual(evidence);
    } finally {
      await db.execute(
        sql`DROP TRIGGER zz_private_review_test_failure ON email_private_intake_reviews`,
      );
      await db.execute(sql`DROP FUNCTION private_review_test_failure()`);
      await db.execute(sql`DROP SEQUENCE private_review_insert_witness`);
    }
  });
});
