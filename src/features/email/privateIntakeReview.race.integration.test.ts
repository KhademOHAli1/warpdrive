import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { lockAuthAccount } from "@/features/auth/better/accountLock";
import { revokeUserAccess } from "@/features/auth/management/offboarding";
import { readPrivateIntake, reviewPrivateIntake } from "./privateIntakeReview";
import {
  heldPrivateReviewMutation,
  installPrivateReviewCommitBarrier,
  observePrivateReview,
  removePrivateReviewCommitBarrier,
  waitPrivateReviewBlockedBy,
} from "./privateIntakeReview.race.test-helpers";
import {
  privateReviewHistory,
  privateReviewMutableSnapshot,
  privateReviewProtectedSnapshot,
  privateReviewSignal,
  seedNativePrivateReview,
} from "./privateIntakeReview.test-helpers";
import type { PrivateIntakeReviewResult } from "./privateIntakeTypes";

it("commits exactly one of two concurrent native reviews at the same ledger revision", async () => {
  await withTestDb(async (db) => {
    const signal = privateReviewSignal();
    const f = await seedNativePrivateReview(db, signal);
    const before = await privateReviewProtectedSnapshot(db, f.accountId, signal);
    const results: PrivateIntakeReviewResult[] = await Promise.all([
      reviewPrivateIntake(db, f.owner.context, f.input, signal),
      reviewPrivateIntake(db, f.owner.context, { ...f.input, decision: "dismiss" }, signal),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, error: "conflict" }]);
    const history = await privateReviewHistory(db, f.id, signal);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ revision: 1, actor_id: f.ownerId });
    expect(await privateReviewProtectedSnapshot(db, f.accountId, signal)).toEqual(before);
  });
});

it("does not save after a concurrent native session revocation wins the auth fence", async () => {
  await withTestDb(async (db) => {
    const signal = privateReviewSignal();
    const f = await seedNativePrivateReview(db, signal);
    const before = await privateReviewMutableSnapshot(db, f.id, signal);
    const revoking = await heldPrivateReviewMutation(
      db,
      async (tx) => {
        await lockAuthAccount(tx, f.ownerId, signal);
        await tx.execute(
          sql`UPDATE sessions SET revoked_at=now() WHERE id=${f.owner.context.sessionId}`,
        );
      },
      signal,
    );
    const saving = reviewPrivateIntake(db, f.owner.context, f.input, signal);
    const observedSaving = observePrivateReview(saving);
    try {
      await waitPrivateReviewBlockedBy(db, revoking.pid, signal);
    } finally {
      revoking.release();
      await Promise.allSettled([revoking.pending, observedSaving]);
    }
    await revoking.pending;
    expect(await saving).toEqual({ ok: false, error: "forbidden" });
    expect(await privateReviewMutableSnapshot(db, f.id, signal)).toEqual(before);
  });
});

it("rechecks mailbox ownership after a competing owner transfer commits", async () => {
  await withTestDb(async (db) => {
    const signal = privateReviewSignal();
    const f = await seedNativePrivateReview(db, signal);
    const successor = await seedUser(db);
    const before = await privateReviewMutableSnapshot(db, f.id, signal);
    const transfer = await heldPrivateReviewMutation(
      db,
      async (tx) => {
        await tx.execute(
          sql`UPDATE email_accounts SET user_id=${successor.id} WHERE id=${f.accountId}`,
        );
      },
      signal,
    );
    const saving = reviewPrivateIntake(db, f.owner.context, f.input, signal);
    const observedSaving = observePrivateReview(saving);
    try {
      await waitPrivateReviewBlockedBy(db, transfer.pid, signal);
    } finally {
      transfer.release();
      await Promise.allSettled([transfer.pending, observedSaving]);
    }
    await transfer.pending;
    expect(await saving).toEqual({ ok: false, error: "not_found" });
    expect(await privateReviewMutableSnapshot(db, f.id, signal)).toEqual(before);
  });
});

it("keeps native owner/session revocation fenced through the history insert and transaction commit", async () => {
  await withTestDb(async (db) => {
    const signal = privateReviewSignal();
    const f = await seedNativePrivateReview(db, signal);
    await installPrivateReviewCommitBarrier(db, signal);
    const before = await privateReviewProtectedSnapshot(db, f.accountId, signal);
    const barrier = await heldPrivateReviewMutation(
      db,
      async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended('private-intake-native-review-test',0))`,
        );
      },
      signal,
    );
    const saving = reviewPrivateIntake(db, f.owner.context, f.input, signal);
    const observedSaving = observePrivateReview(saving);
    let revoking: Promise<void> | null = null;
    let observedRevoking: ReturnType<typeof observePrivateReview<void>> | null = null;
    try {
      const reviewPid = await waitPrivateReviewBlockedBy(db, barrier.pid, signal);
      revoking = revokeUserAccess(db, f.ownerId, signal);
      observedRevoking = observePrivateReview(revoking);
      await waitPrivateReviewBlockedBy(db, reviewPid, signal);
    } finally {
      barrier.release();
      await Promise.allSettled(
        observedRevoking === null
          ? [barrier.pending, observedSaving]
          : [barrier.pending, observedSaving, observedRevoking],
      );
      await removePrivateReviewCommitBarrier(db, AbortSignal.timeout(5000));
    }
    await barrier.pending;
    expect(await saving).toEqual({
      ok: true,
      value: {
        id: f.id,
        revision: 1,
        state: "unverified",
        contentState: "retained",
        decision: "keep_private",
      },
    });
    if (revoking !== null) await revoking;
    expect(await privateReviewHistory(db, f.id, signal)).toEqual([
      { revision: 1, decision: "keep_private", actor_id: f.ownerId },
    ]);
    expect(await privateReviewProtectedSnapshot(db, f.accountId, signal)).toEqual(before);
    expect(await readPrivateIntake(db, f.owner.context, f.scope, signal)).toEqual({
      ok: false,
      error: "forbidden",
    });
  });
});
