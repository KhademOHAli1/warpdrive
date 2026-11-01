import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import type { Db } from "@/db/client";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { ok } from "@/types/result";
import {
  installPrivateLocalReadBarrier,
  removePrivateLocalReadBarrier,
  waitPrivateLocalReadBarrier,
} from "./privateIntakeLocalRead.race.test-helpers";
import {
  type PrivateLocalReadFixture,
  privateLocalReadFixture,
  privateLocalReadMailbox,
  privateLocalReadRemote,
  privateLocalReadRows,
} from "./privateIntakeLocalRead.test-helpers";
import {
  heldPrivateReviewMutation,
  observePrivateReview,
  waitPrivateReviewBlockedBy,
} from "./privateIntakeReview.race.test-helpers";
import { markThreadRead } from "./readState";

type Fence = "user" | "account" | "thread" | "ledger";

async function competingMutation(
  db: Db,
  f: PrivateLocalReadFixture,
  fence: Fence,
  successor: string,
) {
  if (fence === "user")
    await db.execute(sql`UPDATE users SET is_active=false WHERE id=${f.owner.id}`);
  else if (fence === "account")
    await db.execute(sql`UPDATE email_accounts SET user_id=${successor} WHERE id=${f.accountId}`);
  else if (fence === "thread")
    // A no-op thread UPDATE proves the thread row fence itself. DELETE would
    // also wait on ledger cleanup and could falsely credit a missing thread lock.
    await db.execute(sql`UPDATE email_threads SET subject=subject
      WHERE id=${f.threadId} AND account_id=${f.accountId}`);
  else
    await db.execute(sql`UPDATE email_private_intake SET revision=revision+1
      WHERE id=${f.intakeId} AND account_id=${f.accountId}`);
  f.args.signal.throwIfAborted();
}

it.each<Fence>(["user", "account", "thread", "ledger"])(
  "holds the current owner local-read %s fence through the marker insert and commit",
  async (fence) => {
    await withTestDb(async (db) => {
      const f = await privateLocalReadFixture(db);
      try {
        const signal = f.args.signal;
        const successor = await seedUser(db);
        await installPrivateLocalReadBarrier(db, signal);
        const before = await privateLocalReadMailbox(db, f);
        const remote = privateLocalReadRemote(f);
        const barrier = await heldPrivateReviewMutation(
          db,
          async (tx) => {
            await tx.execute(sql`SELECT pg_advisory_xact_lock(
            hashtextextended('private-intake-local-read-test',0))`);
          },
          signal,
        );
        const saving = markThreadRead(db, { actor: f.actor, threadId: f.threadId }, signal, {
          loadConnection: f.loadConnection,
        });
        const observedSaving = observePrivateReview(saving);
        let changing: Promise<void> | null = null;
        let observedChanging: ReturnType<typeof observePrivateReview<void>> | null = null;
        try {
          const atInsert = await waitPrivateLocalReadBarrier(
            db,
            barrier.pid,
            observedSaving,
            signal,
          );
          expect(atInsert).toMatchObject({ kind: "blocked" });
          if (atInsert.kind !== "blocked") return;
          // The preference is not committed yet, and neither mail facts nor remote
          // state have changed while the native marker insert is paused.
          expect(await privateLocalReadRows(db, f)).toEqual([]);
          expect(await privateLocalReadMailbox(db, f)).toEqual(before);
          changing = competingMutation(db, f, fence, successor.id);
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
        await barrier.pending;
        expect(await saving).toEqual(ok({ threadId: f.threadId }));
        if (changing !== null) await changing;
        expect(await privateLocalReadRows(db, f)).toHaveLength(1);
        if (fence === "thread" || fence === "user")
          expect(await privateLocalReadMailbox(db, f)).toEqual(before);
        expect(f.loadConnection).not.toHaveBeenCalled();
        expect(f.append).not.toHaveBeenCalled();
        expect(privateLocalReadRemote(f)).toEqual(remote);
      } finally {
        await f.close();
      }
    });
  },
);
