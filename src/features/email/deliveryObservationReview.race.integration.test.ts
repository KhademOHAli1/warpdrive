import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { lockAuthAccount } from "@/features/auth/better/accountLock";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { deliverySignal, submissionFacts } from "./deliveryObservation.test-helpers";
import { reviewDeliveryReport } from "./deliveryObservationReview";
import { seedObservedDelivery } from "./deliveryObservationReview.test-helpers";

async function heldMutation(db: Db, mutate: (tx: DbOrTx) => Promise<void>) {
  let release!: () => void;
  let started!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const pending = db.transaction(async (tx) => {
    await mutate(tx);
    started();
    await released;
  });
  await Promise.race([ready, pending]);
  return { release, pending };
}

async function expectBlocked(db: Db) {
  await vi.waitFor(
    async () => {
      const blocked = (
        await db.execute(sql`SELECT pid FROM pg_stat_activity
      WHERE datname=current_database() AND pid<>pg_backend_pid()
        AND wait_event_type='Lock' AND state='active'`)
      ).rows;
      expect(blocked.length).toBeGreaterThan(0);
    },
    { timeout: 2000, interval: 10 },
  );
}

describe("delivery review commit-time fences on real PostgreSQL", () => {
  it("commits one review when two confirmed writes race the same revision", async () => {
    await withTestDb(async (db) => {
      const f = await seedObservedDelivery(db);
      const before = await submissionFacts(db, f.attempt.attemptId);
      const results = await Promise.all([
        reviewDeliveryReport(db, f.owner.context, f.association, deliverySignal()),
        reviewDeliveryReport(
          db,
          f.owner.context,
          {
            reportId: f.reportId,
            recipientIndex: 0,
            expectedRevision: 0,
            decision: "dismiss",
            confirmUnverified: true,
          },
          deliverySignal(),
        ),
      ]);
      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, error: "conflict" }]);
      expect((await db.execute(sql`SELECT revision FROM email_delivery_reviews`)).rows).toEqual([
        { revision: 1 },
      ]);
      expect(await submissionFacts(db, f.attempt.attemptId)).toEqual(before);
    });
  });

  it("cannot commit after a concurrent native-session revocation wins the auth fence", async () => {
    await withTestDb(async (db) => {
      const f = await seedObservedDelivery(db);
      const revoking = await heldMutation(db, async (tx) => {
        await lockAuthAccount(tx, f.actor.id, deliverySignal());
        await tx.execute(
          sql`UPDATE sessions SET revoked_at=now() WHERE id=${f.owner.context.sessionId}`,
        );
      });
      const saving = reviewDeliveryReport(db, f.owner.context, f.association, deliverySignal());
      try {
        await expectBlocked(db);
      } finally {
        revoking.release();
        await revoking.pending;
      }
      expect(await saving).toEqual({ ok: false, error: "permission" });
      expect((await db.execute(sql`SELECT id FROM email_delivery_reviews`)).rows).toHaveLength(0);
    });
  });

  it("honors an existing MFA policy tightened concurrently, without inventing a separate review policy", async () => {
    await withTestDb(async (db) => {
      const f = await seedObservedDelivery(db);
      const changing = await heldMutation(db, async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext('warpdrive-auth'),hashtext('mcp-grants'))`,
        );
        await tx.execute(sql`INSERT INTO auth_policies(id,require_mfa_for_all) VALUES(true,true)
          ON CONFLICT(id) DO UPDATE SET require_mfa_for_all=true`);
      });
      const saving = reviewDeliveryReport(db, f.owner.context, f.association, deliverySignal());
      try {
        await expectBlocked(db);
      } finally {
        changing.release();
        await changing.pending;
      }
      expect(await saving).toEqual({ ok: false, error: "permission" });
      expect((await db.execute(sql`SELECT id FROM email_delivery_reviews`)).rows).toHaveLength(0);
    });
  });

  it("cannot associate unreadable source evidence when source trash wins the row fence", async () => {
    await withTestDb(async (db) => {
      const f = await seedObservedDelivery(db);
      const hiding = await heldMutation(db, async (tx) => {
        await tx.execute(
          sql`UPDATE email_threads SET trashed_at=now() WHERE id=${f.source.threadId}`,
        );
      });
      const saving = reviewDeliveryReport(db, f.owner.context, f.association, deliverySignal());
      try {
        await expectBlocked(db);
      } finally {
        hiding.release();
        await hiding.pending;
      }
      expect(await saving).toEqual({ ok: false, error: "not_found" });
      expect((await db.execute(sql`SELECT id FROM email_delivery_reviews`)).rows).toHaveLength(0);
    });
  });

  it("rechecks the selected immutable recipient after a competing attempt-row mutation", async () => {
    await withTestDb(async (db) => {
      const f = await seedObservedDelivery(db);
      const editing = await heldMutation(db, async (tx) => {
        await tx.execute(sql`UPDATE email_send_attempts SET payload=jsonb_set(payload,'{to}','["changed@example.test"]'::jsonb)
          WHERE id=${f.attempt.attemptId}`);
      });
      const saving = reviewDeliveryReport(db, f.owner.context, f.association, deliverySignal());
      try {
        await expectBlocked(db);
      } finally {
        editing.release();
        await editing.pending;
      }
      expect(await saving).toEqual({ ok: false, error: "invalid_input" });
      expect((await db.execute(sql`SELECT id FROM email_delivery_reviews`)).rows).toHaveLength(0);
    });
  });

  it("does not use a stale mailbox owner when ownership changes during review", async () => {
    await withTestDb(async (db) => {
      const f = await seedObservedDelivery(db);
      const successor = await seedUser(db);
      const transfer = await heldMutation(db, async (tx) => {
        await tx.execute(
          sql`UPDATE email_accounts SET user_id=${successor.id} WHERE id=${f.accountId}`,
        );
      });
      const saving = reviewDeliveryReport(db, f.owner.context, f.association, deliverySignal());
      try {
        await expectBlocked(db);
      } finally {
        transfer.release();
        await transfer.pending;
      }
      expect(await saving).toEqual({ ok: false, error: "not_found" });
      expect((await db.execute(sql`SELECT id FROM email_delivery_reviews`)).rows).toHaveLength(0);
    });
  });
});
