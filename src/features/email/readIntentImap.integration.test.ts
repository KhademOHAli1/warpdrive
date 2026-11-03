// Canonical migrated PostgreSQL controls; execution evidence is recorded separately.
import { randomBytes, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { Pool } from "pg";
import { expect, it, vi } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { authUsers, sessions, users } from "@/db/schema";
import { withTestDb } from "@/db/testing";
import { hashSessionCredential } from "@/features/auth/better/sessionToken";
import { lockDeliveryObservationSession } from "@/features/email/deliveryObservationAuthority";
import { imapOperationsFixture } from "@/features/email/imapThreadOperations.test-helpers";
import type { ImapThreadOperationDeps } from "@/features/email/imapThreadOperationsTypes";
import {
  privateLocalReadFixture,
  privateLocalReadMailbox,
  privateLocalReadRemote,
  privateLocalReadRows,
} from "@/features/email/privateIntakeLocalRead.test-helpers";
import { admitThreadReadIntent } from "@/features/email/readIntentExecution";
import {
  prepareThreadReadIntent,
  type ReadIntentActor,
  reconcileThreadReadIntent,
} from "@/features/email/readIntentLifecycle";
import { executeThreadReadIntent } from "@/features/email/readIntents";
import { hydrateOwner } from "@/features/email/syncCursor";
import { ok } from "@/types/result";
import { assertReadIntentSchema } from "./readIntentConstraints.test-helpers";

type ImapFixture = Awaited<ReturnType<typeof imapOperationsFixture>>;
type Loader = NonNullable<ImapThreadOperationDeps["loadConnection"]>;

async function existingOwnerSession(
  db: Db,
  ownerId: string,
  signal: AbortSignal,
): Promise<ReadIntentActor> {
  const [owner] = await db.select().from(users).where(eq(users.id, ownerId));
  if (owner === undefined) throw new AppError(ERROR_IDS.DB_INVARIANT, "Fixture owner missing");
  await db.insert(authUsers).values({
    id: owner.id,
    email: owner.email,
    name: owner.name,
    emailVerified: true,
    twoFactorEnabled: owner.isAdmin,
  });
  const now = new Date();
  const sessionId = randomUUID();
  await db.insert(sessions).values({
    id: sessionId,
    userId: owner.id,
    tokenHash: hashSessionCredential(randomBytes(32).toString("base64url")),
    authMethod: "password",
    assurance: owner.isAdmin ? "mfa" : "password",
    freshAuthenticatedAt: now,
    mfaVerifiedAt: owner.isAdmin ? now : null,
    lastSeenAt: now,
    createdAt: now,
    expiresAt: new Date(now.getTime() + 3_600_000),
  });
  const actor = await hydrateOwner(db, owner.id, signal);
  if (!actor.ok) throw actor.error;
  const session = { actorId: owner.id, sessionId };
  expect(await db.transaction((tx) => lockDeliveryObservationSession(tx, session, signal))).toBe(
    true,
  );
  return { actor: actor.value, session };
}
async function withOrdinary(
  check: (db: Db, f: ImapFixture, native: ReadIntentActor) => Promise<void>,
) {
  await withTestDb(async (db) => {
    await assertReadIntentSchema(db);
    const f = await imapOperationsFixture(db);
    try {
      await check(db, f, await existingOwnerSession(db, f.owner.id, f.signal));
    } finally {
      await f.server.close();
    }
  });
}
async function prepared(db: Db, native: ReadIntentActor, threadId: string, signal: AbortSignal) {
  const result = await prepareThreadReadIntent(db, { ...native, threadId, read: true }, signal);
  if (!result.ok) throw result.error;
  expect(result.value.kind).toBe("created");
  expect(result.value.readIntent).toMatchObject({ threadId, desiredRead: true, state: "prepared" });
  return { ...native, threadId, operationId: result.value.readIntent.operationId, read: true };
}
async function markers(db: Db, threadId: string) {
  return (
    await db.execute(sql`SELECT user_id,read_at::text,xmin::text AS row_version
    FROM email_thread_reads WHERE thread_id=${threadId} ORDER BY user_id`)
  ).rows;
}
async function receipts(db: Db, threadId: string) {
  return (
    await db.execute(sql`SELECT to_jsonb(i) AS receipt,xmin::text AS row_version
    FROM email_read_intents i WHERE thread_id=${threadId} ORDER BY actor_id,operation_id`)
  ).rows;
}
function remote(f: ImapFixture) {
  return {
    commands: [...f.server.state.commands],
    authentications: f.server.authenticationAttempts(),
    folders: Array.from(f.server.state.folders, ([path, folder]) => ({
      path,
      validity: folder.validity,
      readOnly: folder.readOnly,
      specialUse: folder.specialUse ?? null,
      messages: folder.messages.map((m) => ({
        uid: m.uid,
        flags: [...m.flags],
        date: m.date.toISOString(),
        source: m.source.toString("base64"),
      })),
    })),
  };
}

it("commits IMAP admission before runtime loading and STORE, then returns an unchanged applied receipt on duplicate execute", async () => {
  await withOrdinary(async (db, f, native) => {
    const args = await prepared(db, native, f.threadId, f.signal);
    const before = remote(f);
    const pool: unknown = "$client" in db ? db.$client : undefined;
    if (!(pool instanceof Pool)) throw new AppError(ERROR_IDS.DB_INVARIANT, "Fixture pool missing");
    // Holding this client before execute forces admission onto a different connection.
    const observer = await pool.connect();
    try {
      let claim: string | null = null;
      const loadConnection = vi.fn<Loader>(async (_db, accountId, signal) => {
        signal.throwIfAborted();
        expect(accountId).toBe(f.accountId);
        const observed = await observer.query<{
          state: string;
          dispatch_claim: string | null;
          admitted_at: string | null;
          terminal_at: string | null;
        }>(
          "SELECT state,dispatch_claim::text,admitted_at::text,terminal_at::text FROM email_read_intents WHERE actor_id=$1 AND operation_id=$2",
          [native.actor.id, args.operationId],
        );
        signal.throwIfAborted();
        expect(observed.rows).toHaveLength(1);
        expect(observed.rows[0]).toMatchObject({
          state: "admitted",
          dispatch_claim: expect.any(String),
          admitted_at: expect.any(String),
          terminal_at: null,
        });
        claim = observed.rows[0]?.dispatch_claim ?? null;
        expect(remote(f)).toEqual(before);
        return ok(f.runtime);
      });
      const first = await executeThreadReadIntent(db, args, f.signal, { loadConnection });
      expect(first).toMatchObject({
        ok: true,
        value: {
          threadId: f.threadId,
          readIntent: { operationId: args.operationId, desiredRead: true, state: "applied" },
        },
      });
      expect(loadConnection).toHaveBeenCalledTimes(1);
      expect(claim).toEqual(expect.any(String));
      expect(
        f.server.state.commands.filter((command) => command === "STORE").length,
      ).toBeGreaterThan(before.commands.filter((command) => command === "STORE").length);
      const messages = f.server.state.folders.get("INBOX")?.messages.filter((m) => m.uid > 1);
      expect(messages).toHaveLength(2);
      expect(messages?.every((m) => m.flags.includes("\\Seen"))).toBe(true);
      const markerBefore = await markers(db, f.threadId);
      const receiptBefore = await receipts(db, f.threadId);
      expect(markerBefore).toHaveLength(1);
      expect(receiptBefore).toMatchObject([
        {
          receipt: {
            state: "applied",
            dispatch_claim: claim,
            read_mode: "imap",
            terminal_at: expect.any(String),
            error_id: null,
          },
        },
      ]);
      expect(
        (
          await db.execute(sql`SELECT r.read_at>=t.last_message_at AS current
        FROM email_thread_reads r JOIN email_threads t ON t.id=r.thread_id
        WHERE r.thread_id=${f.threadId} AND r.user_id=${native.actor.id}`)
        ).rows,
      ).toEqual([{ current: true }]);
      const after = remote(f);
      expect(await executeThreadReadIntent(db, args, f.signal, { loadConnection })).toEqual(first);
      expect(loadConnection).toHaveBeenCalledTimes(1);
      expect(remote(f)).toEqual(after);
      expect(await markers(db, f.threadId)).toEqual(markerBefore);
      expect(await receipts(db, f.threadId)).toEqual(receiptBefore);
    } finally {
      observer.release();
    }
  });
});

it("cancels a prepared IMAP operation and fences its late execute before runtime loading or STORE", async () => {
  await withOrdinary(async (db, f, native) => {
    const args = await prepared(db, native, f.threadId, f.signal);
    const before = remote(f);
    const markerBefore = await markers(db, f.threadId);
    const loadConnection = vi.fn<Loader>(() => Promise.resolve(ok(f.runtime)));
    expect(await reconcileThreadReadIntent(db, args, f.signal)).toMatchObject({
      ok: true,
      value: { operationId: args.operationId, state: "cancelled" },
    });
    const receiptBefore = await receipts(db, f.threadId);
    expect(await executeThreadReadIntent(db, args, f.signal, { loadConnection })).toMatchObject({
      ok: false,
      error: { id: ERROR_IDS.MAIL_CONNECTION_CHANGED },
    });
    expect(loadConnection).not.toHaveBeenCalled();
    expect(remote(f)).toEqual(before);
    expect(await markers(db, f.threadId)).toEqual(markerBefore);
    expect(await receipts(db, f.threadId)).toEqual(receiptBefore);
  });
});

it("applies a held private IMAP copy locally without runtime loading, remote commands or SMTP changes", async () => {
  await withTestDb(async (db) => {
    await assertReadIntentSchema(db);
    const f = await privateLocalReadFixture(db, true);
    try {
      const native = await existingOwnerSession(db, f.owner.id, f.args.signal);
      const before = await privateLocalReadMailbox(db, f);
      const remoteBefore = privateLocalReadRemote(f);
      const args = await prepared(db, native, f.threadId, f.args.signal);
      expect(await privateLocalReadRows(db, f)).toEqual([]);
      // Witness the persisted preparation before execution: held copies must be
      // classified locally, rather than reaching a remote privacy denial later.
      expect(
        (
          await db.execute(sql`SELECT private_copy,read_mode FROM email_read_intents
        WHERE actor_id=${native.actor.id} AND operation_id=${args.operationId}`)
        ).rows,
      ).toEqual([{ private_copy: true, read_mode: "local" }]);
      const executed = await executeThreadReadIntent(db, args, f.args.signal, {
        loadConnection: f.loadConnection,
      });
      expect(
        executed.ok,
        executed.ok ? undefined : `Held-copy read rejected: ${executed.error.id}`,
      ).toBe(true);
      expect(executed).toMatchObject({
        ok: true,
        value: { readIntent: { operationId: args.operationId, state: "applied" } },
      });
      expect(await privateLocalReadRows(db, f)).toMatchObject([
        { thread_id: f.threadId, user_id: native.actor.id },
      ]);
      expect(await receipts(db, f.threadId)).toMatchObject([
        {
          receipt: {
            state: "applied",
            private_copy: true,
            read_mode: "local",
            dispatch_claim: expect.any(String),
            terminal_at: expect.any(String),
          },
        },
      ]);
      expect(
        (
          await db.execute(sql`SELECT r.read_at>=t.last_message_at AS current
        FROM email_thread_reads r JOIN email_threads t ON t.id=r.thread_id
        WHERE r.thread_id=${f.threadId} AND r.user_id=${native.actor.id}`)
        ).rows,
      ).toEqual([{ current: true }]);
      expect(f.loadConnection).not.toHaveBeenCalled();
      expect(f.append).not.toHaveBeenCalled();
      expect(privateLocalReadRemote(f)).toEqual(remoteBefore);
      expect(await privateLocalReadMailbox(db, f)).toEqual(before);
    } finally {
      await f.close();
    }
  });
});

it("retains a committed admission when a caller stops before provider invocation, without claim takeover or replay", async () => {
  await withOrdinary(async (db, f, native) => {
    const args = await prepared(db, native, f.threadId, f.signal);
    const before = remote(f);
    const markerBefore = await markers(db, f.threadId);
    // Intentionally stop after the committed descriptor. This is not an OS crash test.
    const admitted = await admitThreadReadIntent(db, args, f.signal);
    expect(admitted.kind).toBe("remote");
    if (admitted.kind !== "remote")
      throw new AppError(ERROR_IDS.DB_INVARIANT, "Remote descriptor missing");
    const receiptBefore = await receipts(db, f.threadId);
    expect(receiptBefore).toMatchObject([
      {
        receipt: {
          operation_id: args.operationId,
          state: "admitted",
          dispatch_claim: admitted.claim,
          admitted_at: expect.any(String),
          terminal_at: null,
        },
      },
    ]);
    const loadConnection = vi.fn<Loader>(() => Promise.resolve(ok(f.runtime)));
    expect(await executeThreadReadIntent(db, args, f.signal, { loadConnection })).toMatchObject({
      ok: false,
      error: { id: ERROR_IDS.MAIL_WRITE_UNKNOWN },
    });
    expect(
      await prepareThreadReadIntent(db, { ...native, threadId: f.threadId, read: false }, f.signal),
    ).toMatchObject({
      ok: true,
      value: {
        kind: "blocked",
        readIntent: { operationId: args.operationId, desiredRead: true, state: "admitted" },
      },
    });
    expect(await reconcileThreadReadIntent(db, args, f.signal)).toMatchObject({
      ok: true,
      value: { operationId: args.operationId, state: "admitted" },
    });
    expect(loadConnection).not.toHaveBeenCalled();
    expect(remote(f)).toEqual(before);
    expect(await markers(db, f.threadId)).toEqual(markerBefore);
    expect(await receipts(db, f.threadId)).toEqual(receiptBefore);
  });
});
