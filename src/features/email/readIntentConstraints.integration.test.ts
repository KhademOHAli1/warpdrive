// Canonical migrated PostgreSQL controls; execution evidence is recorded separately.
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import {
  heldPrivateReviewMutation,
  observePrivateReview,
  waitPrivateReviewBlockedBy,
} from "@/features/email/privateIntakeReview.race.test-helpers";
import {
  admit,
  intent,
  prepare,
  rejected,
  unknown,
  withIntentDb,
} from "./readIntentConstraints.test-helpers";

it("begins prepared with no claim and requires a positive connection generation", async () => {
  await withIntentDb(async (db, f) => {
    await rejected(prepare(db, f, { generation: 0 }), "connection_generation");
    const row = await prepare(db, f);
    expect(row.rows).toHaveLength(1);
    expect(await intent(db, f, row.id)).toMatchObject({
      state: "prepared",
      dispatch_claim: null,
      admitted_at: null,
      terminal_at: null,
      error_id: null,
      connection_generation: 1,
    });
  });
});

it("rejects an initially admitted row even when its claim fields are consistent", async () => {
  await withIntentDb(async (db, f) => {
    await rejected(
      db.execute(sql`INSERT INTO email_read_intents
      (actor_id,operation_id,account_id,thread_id,mailbox_owner_id,account_provider,
        connection_generation,private_copy,desired_read,read_mode,state,created_at,admit_before,
        admitted_at,dispatch_claim)
      VALUES (${f.actorId},${randomUUID()},${f.accountId},${f.threadId},${f.actorId},'gmail',1,
        true,true,'local','admitted',clock_timestamp(),clock_timestamp()+interval '1 minute',
        clock_timestamp(),${randomUUID()})`),
      "must begin prepared",
    );
    expect((await db.execute(sql`SELECT operation_id FROM email_read_intents`)).rows).toHaveLength(
      0,
    );
  });
});

it("keeps the prepared command fingerprint immutable", async () => {
  await withIntentDb(async (db, f) => {
    const { id } = await prepare(db, f);
    const before = await intent(db, f, id);
    await rejected(
      db.execute(sql`UPDATE email_read_intents SET desired_read=false
      WHERE actor_id=${f.actorId} AND operation_id=${id}`),
      "immutable mail read intent",
    );
    await rejected(
      db.execute(sql`UPDATE email_read_intents SET connection_generation=2
      WHERE actor_id=${f.actorId} AND operation_id=${id}`),
      "immutable mail read intent",
    );
    expect(await intent(db, f, id)).toEqual(before);
  });
});

it("serializes concurrent prepares behind the unresolved actor/thread unique barrier", async () => {
  await withIntentDb(async (db, f) => {
    const firstId = randomUUID();
    const signal = AbortSignal.timeout(15_000);
    const holder = await heldPrivateReviewMutation(
      db,
      async (tx) => {
        await tx.execute(sql`SET LOCAL statement_timeout='5s'`);
        await prepare(tx, f, { operationId: firstId });
      },
      signal,
    );
    const held = observePrivateReview(holder.pending);
    const contender = observePrivateReview(
      db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL statement_timeout='5s'`);
        return prepare(tx, f);
      }),
    );
    try {
      await waitPrivateReviewBlockedBy(db, holder.pid, signal);
    } finally {
      holder.release();
      await Promise.all([held, contender]);
    }
    const first = await held;
    const second = await contender;
    if (first.status === "rejected") throw first.reason;
    if (second.status === "rejected") throw second.reason;
    expect(second.value.rows).toHaveLength(0);
    expect((await db.execute(sql`SELECT operation_id FROM email_read_intents`)).rows).toEqual([
      { operation_id: firstId },
    ]);
  });
});

it("allows local prepared to admitted to applied while retaining the dispatch claim", async () => {
  await withIntentDb(async (db, f) => {
    const { id } = await prepare(db, f);
    const claim = await admit(db, f, id);
    await db.execute(sql`UPDATE email_read_intents SET state='applied',terminal_at=clock_timestamp()
      WHERE actor_id=${f.actorId} AND operation_id=${id}`);
    expect(await intent(db, f, id)).toMatchObject({
      state: "applied",
      dispatch_claim: claim,
      admitted_at: expect.any(String),
      terminal_at: expect.any(String),
      error_id: null,
    });
    expect(
      (
        await db.execute(sql`SELECT created_at<admitted_at AS created_before_admitted,
      admitted_at<admit_before AS admitted_before_deadline,
      admitted_at<=terminal_at AS admitted_before_terminal FROM email_read_intents
      WHERE actor_id=${f.actorId} AND operation_id=${id}`)
      ).rows,
    ).toEqual([
      {
        created_before_admitted: true,
        admitted_before_deadline: true,
        admitted_before_terminal: true,
      },
    ]);
  });
});

it("does not allow cancellation after admission", async () => {
  await withIntentDb(async (db, f) => {
    const { id } = await prepare(db, f);
    await admit(db, f, id);
    const before = await intent(db, f, id);
    await rejected(
      db.execute(sql`UPDATE email_read_intents SET state='cancelled',terminal_at=clock_timestamp()
      WHERE actor_id=${f.actorId} AND operation_id=${id}`),
      "invalid mail read intent transition",
    );
    expect(await intent(db, f, id)).toEqual(before);
  });
});

it("rejects admission after the prepared deadline without adding a claim", async () => {
  await withIntentDb(async (db, f) => {
    const { id } = await prepare(db, f, { expired: true });
    await rejected(admit(db, f, id), "expired mail read intent admission");
    expect(await intent(db, f, id)).toMatchObject({
      state: "prepared",
      dispatch_claim: null,
      admitted_at: null,
    });
  });
});

it("does not permit a terminal receipt timestamp to be rewritten", async () => {
  await withIntentDb(async (db, f) => {
    const { id } = await prepare(db, f);
    await admit(db, f, id);
    await db.execute(sql`UPDATE email_read_intents SET state='applied',terminal_at=clock_timestamp()
      WHERE actor_id=${f.actorId} AND operation_id=${id}`);
    const before = await intent(db, f, id);
    await rejected(
      db.execute(sql`UPDATE email_read_intents SET terminal_at=terminal_at+interval '1 second'
      WHERE actor_id=${f.actorId} AND operation_id=${id}`),
      "terminal mail read receipt",
    );
    expect(await intent(db, f, id)).toEqual(before);
  });
});

it("does not reset an unknown operation to prepared", async () => {
  await withIntentDb(async (db, f) => {
    const { id } = await prepare(db, f);
    await unknown(db, f, id);
    const before = await intent(db, f, id);
    await rejected(
      db.execute(sql`UPDATE email_read_intents SET state='prepared'
      WHERE actor_id=${f.actorId} AND operation_id=${id}`),
      "invalid mail read intent transition",
    );
    expect(await intent(db, f, id)).toEqual(before);
  });
});

it("does not permit dispatch-claim takeover of an unknown operation", async () => {
  await withIntentDb(async (db, f) => {
    const { id } = await prepare(db, f);
    await unknown(db, f, id);
    const before = await intent(db, f, id);
    await rejected(
      db.execute(sql`UPDATE email_read_intents SET dispatch_claim=${randomUUID()}
      WHERE actor_id=${f.actorId} AND operation_id=${id}`),
      "immutable mail read dispatch claim",
    );
    expect(await intent(db, f, id)).toEqual(before);
  });
});

it("does not prune an unknown operation or release its unresolved barrier", async () => {
  await withIntentDb(async (db, f) => {
    const { id } = await prepare(db, f);
    await unknown(db, f, id);
    const before = await intent(db, f, id);
    await rejected(
      db.execute(sql`DELETE FROM email_read_intents
      WHERE actor_id=${f.actorId} AND operation_id=${id}`),
      "unresolved mail read intent cannot be pruned",
    );
    expect(await intent(db, f, id)).toEqual(before);
    expect((await prepare(db, f)).rows).toHaveLength(0);
  });
});

it("binds the thread to its recorded account through the composite foreign key", async () => {
  await withIntentDb(async (db, f) => {
    const other = (
      await db.execute(sql`INSERT INTO email_accounts (user_id,email_address,status)
      VALUES (${f.actorId},${`${randomUUID()}@example.test`},'connected') RETURNING id`)
    ).rows[0];
    if (typeof other?.id !== "string") throw new Error("second account fixture missing");
    await rejected(prepare(db, f, { accountId: other.id }), "foreign key constraint", "23503");
    expect((await db.execute(sql`SELECT operation_id FROM email_read_intents`)).rows).toHaveLength(
      0,
    );
  });
});
