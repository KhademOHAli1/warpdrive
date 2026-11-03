// Canonical migrated PostgreSQL controls; execution evidence is recorded separately.
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { withTestDb } from "@/db/testing";
import { lockDeliveryObservationSession } from "@/features/email/deliveryObservationAuthority";
import type { ImapThreadOperationDeps } from "@/features/email/imapThreadOperationsTypes";
import { seedMailHttpSession } from "@/features/email/mailConnectionHttp.test-helpers";
import {
  prepareThreadReadIntent,
  type ReadIntentActor,
  reconcileThreadReadIntent,
} from "@/features/email/readIntentLifecycle";
import { lockReadIntentScope } from "@/features/email/readIntentScope";
import { executeThreadReadIntent } from "@/features/email/readIntents";
import { hydrateOwner } from "@/features/email/syncCursor";
import { assertReadIntentSchema, rejected } from "./readIntentConstraints.test-helpers";

async function nativeActor(db: Db, signal: AbortSignal, isAdmin = false): Promise<ReadIntentActor> {
  const native = await seedMailHttpSession(db, {
    isAdmin,
    twoFactorEnabled: isAdmin,
    assurance: isAdmin ? "mfa" : "password",
    mfaAt: isAdmin ? new Date() : null,
  });
  const actor = await hydrateOwner(db, native.user.id, signal);
  if (!actor.ok) throw actor.error;
  expect(
    await db.transaction((tx) => lockDeliveryObservationSession(tx, native.context, signal)),
  ).toBe(true);
  return { actor: actor.value, session: native.context };
}

async function lifecycleFixture(db: Db) {
  const signal = AbortSignal.timeout(15_000);
  const native = await nativeActor(db, signal);
  const accountId = randomUUID();
  const threadId = randomUUID();
  await db.execute(sql`INSERT INTO email_accounts (id,user_id,email_address,status,provider)
    VALUES (${accountId},${native.actor.id},${`${accountId}@example.test`},'connected','gmail')`);
  await db.execute(sql`INSERT INTO email_threads
    (id,account_id,gmail_thread_id,subject,last_message_at,visibility)
    VALUES (${threadId},${accountId},'lifecycle','چرخه خواندن / Lesestatus',
      '2026-11-01 12:00:00.123456+00'::timestamptz,'private')`);
  const provider = vi.fn<NonNullable<ImapThreadOperationDeps["loadConnection"]>>(() =>
    Promise.reject(
      new AppError(ERROR_IDS.DB_INVARIANT, "Local fixture reached credential resolution"),
    ),
  );
  return { native, accountId, threadId, signal, provider };
}
type Fixture = Awaited<ReturnType<typeof lifecycleFixture>>;

async function providerRows(db: Db, f: Fixture) {
  return (
    await db.execute(sql`SELECT to_jsonb(a) AS account,to_jsonb(t) AS thread
    FROM email_accounts a JOIN email_threads t ON t.account_id=a.id
    WHERE a.id=${f.accountId} AND t.id=${f.threadId}`)
  ).rows;
}
async function markers(db: Db, f: Fixture) {
  return (
    await db.execute(sql`SELECT user_id,read_at::text,xmin::text AS row_version
    FROM email_thread_reads WHERE thread_id=${f.threadId} ORDER BY user_id`)
  ).rows;
}
async function receipts(db: Db, f: Fixture) {
  return (
    await db.execute(sql`SELECT to_jsonb(i) AS receipt,xmin::text AS row_version
    FROM email_read_intents i WHERE thread_id=${f.threadId} ORDER BY actor_id,operation_id`)
  ).rows;
}
async function withLifecycle(check: (db: Db, f: Fixture) => Promise<void>) {
  await withTestDb(async (db) => {
    await assertReadIntentSchema(db);
    const f = await lifecycleFixture(db);
    const before = await providerRows(db, f);
    await check(db, f);
    expect(f.provider).not.toHaveBeenCalled();
    expect(await providerRows(db, f)).toEqual(before);
  });
}
async function prepared(db: Db, f: Fixture, read = true) {
  const result = await prepareThreadReadIntent(
    db,
    { ...f.native, threadId: f.threadId, read },
    f.signal,
  );
  if (!result.ok) throw result.error;
  expect(result.value.kind).toBe("created");
  expect(result.value.readIntent).toMatchObject({
    threadId: f.threadId,
    desiredRead: read,
    state: "prepared",
  });
  return result.value.readIntent;
}
function execute(db: Db, f: Fixture, operationId: string, read = true, native = f.native) {
  return executeThreadReadIntent(
    db,
    { ...native, threadId: f.threadId, operationId, read },
    f.signal,
    { loadConnection: f.provider },
  );
}
function reconcile(db: Db, f: Fixture, operationId: string, native = f.native) {
  return reconcileThreadReadIntent(db, { ...native, threadId: f.threadId, operationId }, f.signal);
}
function privateMissing(result: unknown, f: Fixture, operationId: string) {
  expect(result).toMatchObject({
    ok: false,
    error: { id: ERROR_IDS.GMAIL_THREAD_NOT_FOUND, message: "thread not found" },
  });
  expect(result).not.toHaveProperty("value");
  expect(JSON.stringify(result)).not.toContain(operationId);
  expect(JSON.stringify(result)).not.toContain(f.threadId);
}

it("prepares a durable local command without writing a marker or provider state", async () => {
  await withLifecycle(async (db, f) => {
    const operation = await prepared(db, f);
    expect(await markers(db, f)).toEqual([]);
    expect(await receipts(db, f)).toMatchObject([
      {
        receipt: {
          actor_id: f.native.actor.id,
          operation_id: operation.operationId,
          state: "prepared",
          desired_read: true,
          read_mode: "local",
          dispatch_claim: null,
          admitted_at: null,
          terminal_at: null,
          error_id: null,
        },
      },
    ]);
  });
});

it("returns one created and one blocked receipt for concurrent prepares of the same actor/thread", async () => {
  await withLifecycle(async (db, f) => {
    const args = { ...f.native, threadId: f.threadId, read: true };
    const [first, second] = await Promise.all([
      prepareThreadReadIntent(db, args, f.signal),
      prepareThreadReadIntent(db, args, f.signal),
    ]);
    if (!first.ok) throw first.error;
    if (!second.ok) throw second.error;
    expect([first.value.kind, second.value.kind].sort()).toEqual(["blocked", "created"]);
    expect(first.value.readIntent).toEqual(second.value.readIntent);
    expect(await receipts(db, f)).toHaveLength(1);
    expect(await markers(db, f)).toEqual([]);
  });
});

it("cancels first, applies a new opposite command, and fences late execution of the cancelled UUID", async () => {
  await withLifecycle(async (db, f) => {
    const old = await prepared(db, f, false);
    expect(await reconcile(db, f, old.operationId)).toMatchObject({
      ok: true,
      value: { state: "cancelled" },
    });
    const current = await prepared(db, f, true);
    expect(current.operationId).not.toBe(old.operationId);
    expect(await execute(db, f, current.operationId)).toMatchObject({
      ok: true,
      value: { readIntent: { state: "applied" } },
    });
    const markerBefore = await markers(db, f);
    const receiptBefore = await receipts(db, f);
    expect(markerBefore).toHaveLength(1);
    expect(await execute(db, f, old.operationId, false)).toMatchObject({
      ok: false,
      error: { id: ERROR_IDS.MAIL_CONNECTION_CHANGED },
    });
    expect(await markers(db, f)).toEqual(markerBefore);
    expect(await receipts(db, f)).toEqual(receiptBefore);
  });
});

it("returns the same applied receipt on duplicate execution without rewriting the exact marker or receipt", async () => {
  await withLifecycle(async (db, f) => {
    const operation = await prepared(db, f);
    const first = await execute(db, f, operation.operationId);
    expect(first).toMatchObject({ ok: true, value: { readIntent: { state: "applied" } } });
    if (!first.ok) throw first.error;
    const markerBefore = await markers(db, f);
    const receiptBefore = await receipts(db, f);
    expect(markerBefore).toHaveLength(1);
    expect(receiptBefore).toMatchObject([
      {
        receipt: {
          state: "applied",
          dispatch_claim: expect.any(String),
          terminal_at: expect.any(String),
        },
      },
    ]);
    expect(await execute(db, f, operation.operationId)).toEqual(first);
    expect(await reconcile(db, f, operation.operationId)).toEqual({
      ok: true,
      value: first.value.readIntent,
    });
    expect(await markers(db, f)).toEqual(markerBefore);
    expect(await receipts(db, f)).toEqual(receiptBefore);
  });
});

it("rolls back the marker and admission on a real 23514 applied-receipt rejection, then permits cancellation", async () => {
  await withLifecycle(async (db, f) => {
    const operation = await prepared(db, f);
    const before = await receipts(db, f);
    await db.execute(sql`CREATE FUNCTION reject_lifecycle_applied() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN
        RAISE EXCEPTION 'fixture applied receipt rejected' USING ERRCODE='23514';
      END; $$`);
    await db.execute(sql`CREATE TRIGGER reject_lifecycle_applied
      BEFORE UPDATE OF state ON email_read_intents FOR EACH ROW
      WHEN (NEW.state='applied') EXECUTE FUNCTION reject_lifecycle_applied()`);
    await rejected(
      execute(db, f, operation.operationId),
      "fixture applied receipt rejected",
      "23514",
    );
    expect(await markers(db, f)).toEqual([]);
    expect(await receipts(db, f)).toEqual(before);
    expect(await reconcile(db, f, operation.operationId)).toMatchObject({
      ok: true,
      value: { state: "cancelled" },
    });
    expect(await receipts(db, f)).toMatchObject([
      {
        receipt: {
          state: "cancelled",
          dispatch_claim: null,
          admitted_at: null,
          terminal_at: expect.any(String),
        },
      },
    ]);
    expect(await markers(db, f)).toEqual([]);
  });
});

it("denies execution and reconciliation when the native session is revoked after preparation", async () => {
  await withLifecycle(async (db, f) => {
    const operation = await prepared(db, f);
    const before = await receipts(db, f);
    await db.execute(
      sql`UPDATE sessions SET revoked_at=clock_timestamp() WHERE id=${f.native.session.sessionId}`,
    );
    privateMissing(await execute(db, f, operation.operationId), f, operation.operationId);
    privateMissing(await reconcile(db, f, operation.operationId), f, operation.operationId);
    expect(await receipts(db, f)).toEqual(before);
    expect(await markers(db, f)).toEqual([]);
  });
});

it("gives a foreign native administrator private 404s without exposing or mutating the owner's receipt", async () => {
  await withLifecycle(async (db, f) => {
    const operation = await prepared(db, f);
    const foreign = await nativeActor(db, f.signal, true);
    const before = await receipts(db, f);
    privateMissing(
      await prepareThreadReadIntent(db, { ...foreign, threadId: f.threadId, read: true }, f.signal),
      f,
      operation.operationId,
    );
    privateMissing(
      await execute(db, f, operation.operationId, true, foreign),
      f,
      operation.operationId,
    );
    privateMissing(
      await reconcile(db, f, operation.operationId, foreign),
      f,
      operation.operationId,
    );
    expect(await receipts(db, f)).toEqual(before);
    expect(await markers(db, f)).toEqual([]);
  });
});

it("cancels an already expired preparation with its correct server-derived binding and writes no marker", async () => {
  await withLifecycle(async (db, f) => {
    const operationId = randomUUID();
    await db.transaction(async (tx) => {
      const scope = await lockReadIntentScope(
        tx,
        { actor: f.native.actor, threadId: f.threadId, desiredRead: true },
        f.signal,
      );
      if (!scope.ok) throw scope.error;
      const b = scope.value.binding;
      await tx.execute(sql`INSERT INTO email_read_intents
        (actor_id,operation_id,account_id,thread_id,mailbox_owner_id,account_provider,
          connection_generation,private_copy,desired_read,read_mode,created_at,admit_before)
        VALUES (${b.actorId},${operationId},${b.accountId},${b.threadId},${b.mailboxOwnerId},
          ${b.accountProvider},${b.connectionGeneration},${b.privateCopy},${b.desiredRead},${b.readMode},
          clock_timestamp()-interval '2 minutes',clock_timestamp()-interval '1 minute')`);
    });
    const timestamps = async () =>
      (
        await db.execute(sql`SELECT created_at::text,admit_before::text
      FROM email_read_intents WHERE actor_id=${f.native.actor.id} AND operation_id=${operationId}`)
      ).rows;
    const before = await timestamps();
    expect(await execute(db, f, operationId)).toMatchObject({
      ok: false,
      error: { id: ERROR_IDS.MAIL_CONNECTION_CHANGED },
    });
    expect(await reconcile(db, f, operationId)).toMatchObject({
      ok: true,
      value: { state: "cancelled", operationId },
    });
    const after = await receipts(db, f);
    expect(after).toMatchObject([
      {
        receipt: {
          state: "cancelled",
          dispatch_claim: null,
          admitted_at: null,
        },
      },
    ]);
    expect(await timestamps()).toEqual(before);
    expect(await markers(db, f)).toEqual([]);
  });
});
