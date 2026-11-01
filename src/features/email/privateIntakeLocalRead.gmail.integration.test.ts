import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { ok } from "@/types/result";
import {
  foreignPrivateGmailReader,
  privateGmailLocalReadCaps,
  privateGmailLocalReadFixture,
  privateGmailLocalReadRows,
  privateGmailLocalReadSnapshot,
} from "./privateIntakeLocalRead.gmail.test-helpers";
import {
  installPrivateLocalReadBarrier,
  removePrivateLocalReadBarrier,
  waitPrivateLocalReadBarrier,
} from "./privateIntakeLocalRead.race.test-helpers";
import {
  heldPrivateReviewMutation,
  observePrivateReview,
  waitPrivateReviewBlockedBy,
} from "./privateIntakeReview.race.test-helpers";
import { markThreadRead, markThreadUnread } from "./readState";

it("keeps Gmail held-copy read preferences local for both regular and administrator owners", async () => {
  await withTestDb(async (db) => {
    const signal = AbortSignal.timeout(30_000);
    for (const admin of [false, true]) {
      const f = await privateGmailLocalReadFixture(db, signal, admin);
      const before = await privateGmailLocalReadSnapshot(db, f);
      expect(await privateGmailLocalReadCaps(db, f)).toEqual({
        read: true,
        send: false,
        markRead: false,
        localRead: true,
        move: false,
        trash: false,
      });
      expect(await markThreadRead(db, { actor: f.actor, threadId: f.threadId }, signal)).toEqual(
        ok({ threadId: f.threadId }),
      );
      expect(await privateGmailLocalReadRows(db, f)).toMatchObject([
        { thread_id: f.threadId, user_id: f.ownerId, read_at: expect.any(Date) },
      ]);
      expect(await markThreadUnread(db, { actor: f.actor, threadId: f.threadId }, signal)).toEqual(
        ok({ threadId: f.threadId }),
      );
      expect(await privateGmailLocalReadRows(db, f)).toEqual([]);
      expect(await privateGmailLocalReadSnapshot(db, f)).toEqual(before);
    }
  });
});

it("denies a foreign Gmail administrator and a cached owner after native deactivation", async () => {
  await withTestDb(async (db) => {
    const signal = AbortSignal.timeout(30_000);
    const f = await privateGmailLocalReadFixture(db, signal);
    const foreign = await foreignPrivateGmailReader(db, f);
    await db.execute(sql`INSERT INTO email_thread_reads(thread_id,user_id,read_at)
      VALUES(${f.threadId},${f.ownerId},clock_timestamp())`);
    const choice = await privateGmailLocalReadRows(db, f);
    for (const actor of [foreign, f.actor]) {
      if (actor.id === f.ownerId)
        await db.execute(sql`UPDATE users SET is_active=false WHERE id=${f.ownerId}`);
      const before = await privateGmailLocalReadSnapshot(db, f);
      for (const change of [markThreadRead, markThreadUnread])
        expect(await change(db, { actor, threadId: f.threadId }, signal)).toMatchObject({
          ok: false,
          error: { id: "E_GMAIL_011" },
        });
      expect(await privateGmailLocalReadCaps(db, f, actor)).toMatchObject({
        localRead: false,
        markRead: false,
      });
      expect(await privateGmailLocalReadRows(db, f)).toEqual(choice);
      expect(await privateGmailLocalReadSnapshot(db, f)).toEqual(before);
    }
  });
});

it("holds Gmail's current reader authority through the native local marker commit", async () => {
  await withTestDb(async (db) => {
    const signal = AbortSignal.timeout(30_000);
    const f = await privateGmailLocalReadFixture(db, signal);
    await installPrivateLocalReadBarrier(db, signal);
    const before = await privateGmailLocalReadSnapshot(db, f);
    const barrier = await heldPrivateReviewMutation(
      db,
      (tx) =>
        tx
          .execute(sql`SELECT pg_advisory_xact_lock(
        hashtextextended('private-intake-local-read-test',0))`)
          .then(() => undefined),
      signal,
    );
    const saving = markThreadRead(db, { actor: f.actor, threadId: f.threadId }, signal);
    const observedSaving = observePrivateReview(saving);
    let changing: Promise<unknown> | null = null;
    let observedChanging: ReturnType<typeof observePrivateReview<unknown>> | null = null;
    try {
      const atInsert = await waitPrivateLocalReadBarrier(db, barrier.pid, observedSaving, signal);
      expect(atInsert).toMatchObject({ kind: "blocked" });
      if (atInsert.kind !== "blocked") return;
      expect(await privateGmailLocalReadRows(db, f)).toEqual([]);
      changing = db.execute(sql`UPDATE users SET is_active=false WHERE id=${f.ownerId}`);
      observedChanging = observePrivateReview(changing);
      await waitPrivateReviewBlockedBy(db, atInsert.pid, signal);
    } finally {
      barrier.release();
      await Promise.allSettled(
        observedChanging === null
          ? [barrier.pending, observedSaving]
          : [barrier.pending, observedSaving, observedChanging],
      );
      await removePrivateLocalReadBarrier(db, AbortSignal.timeout(5000));
    }
    expect(await saving).toEqual(ok({ threadId: f.threadId }));
    if (changing !== null) await changing;
    expect(await privateGmailLocalReadRows(db, f)).toHaveLength(1);
    expect(await privateGmailLocalReadSnapshot(db, f)).toEqual(before);
  });
});
