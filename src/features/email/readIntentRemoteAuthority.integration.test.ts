// Canonical migrated PostgreSQL controls; execution evidence is recorded separately.
// The invalidation is committed before the designated mutation checks. This is
// not a claim of linearizable revocation against an already dispatched STORE.
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
  prepareThreadReadIntent,
  type ReadIntentActor,
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

function remoteFlags(f: ImapFixture) {
  return Array.from(f.server.state.folders, ([path, folder]) => ({
    path,
    messages: folder.messages.map((message) => ({
      uid: message.uid,
      flags: [...message.flags],
      source: message.source.toString("base64"),
    })),
  }));
}

async function markers(db: Db, threadId: string) {
  return (
    await db.execute(sql`SELECT user_id,read_at::text,xmin::text AS row_version
    FROM email_thread_reads WHERE thread_id=${threadId} ORDER BY user_id`)
  ).rows;
}

it.each(["revoked", "expired"] as const)(
  "does not STORE when the native session is %s after durable admission and before runtime returns",
  async (reason) => {
    await withTestDb(async (db) => {
      await assertReadIntentSchema(db);
      const f = await imapOperationsFixture(db);
      try {
        const native = await existingOwnerSession(db, f.owner.id, f.signal);
        const preparation = await prepareThreadReadIntent(
          db,
          {
            ...native,
            threadId: f.threadId,
            read: true,
          },
          f.signal,
        );
        if (!preparation.ok) throw preparation.error;
        expect(preparation.value.kind).toBe("created");
        const args = {
          ...native,
          threadId: f.threadId,
          read: true,
          operationId: preparation.value.readIntent.operationId,
        };
        const pool: unknown = "$client" in db ? db.$client : undefined;
        if (!(pool instanceof Pool))
          throw new AppError(ERROR_IDS.DB_INVARIANT, "Fixture pool missing");
        // Holding this observer forces the admission onto another pooled client.
        // UPDATE on this idle client returns after its own autocommit completes.
        const observer = await pool.connect();
        try {
          const flagsBefore = remoteFlags(f);
          const markerBefore = await markers(db, f.threadId);
          const storesBefore = f.server.state.commands.filter(
            (command) => command === "STORE",
          ).length;
          let committedClaim: string | null = null;
          let invalidationObserved = false;
          let loaderFailure: { error: unknown } | undefined;
          const loadConnection = vi.fn<Loader>(async (_db, accountId, signal) => {
            try {
              signal.throwIfAborted();
              expect(accountId).toBe(f.accountId);
              const admitted = await observer.query<{
                state: string;
                dispatch_claim: string | null;
              }>(
                "SELECT state,dispatch_claim::text FROM email_read_intents WHERE actor_id=$1 AND operation_id=$2",
                [native.actor.id, args.operationId],
              );
              expect(admitted.rows).toHaveLength(1);
              expect(admitted.rows[0]).toMatchObject({
                state: "admitted",
                dispatch_claim: expect.any(String),
              });
              committedClaim = admitted.rows[0]?.dispatch_claim ?? null;
              expect(remoteFlags(f)).toEqual(flagsBefore);
              expect(f.server.state.commands.filter((command) => command === "STORE")).toHaveLength(
                storesBefore,
              );
              expect(observer.getTransactionStatus()).toBe("I");
              const invalidation =
                reason === "revoked"
                  ? "UPDATE sessions SET revoked_at=clock_timestamp() WHERE id=$1 RETURNING id"
                  : "UPDATE sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1 RETURNING id";
              const invalidated = await observer.query<{ id: string }>(invalidation, [
                native.session.sessionId,
              ]);
              expect(invalidated.rows).toEqual([{ id: native.session.sessionId }]);
              expect(observer.getTransactionStatus()).toBe("I");
              expect(
                await db.transaction((tx) =>
                  lockDeliveryObservationSession(tx, native.session, signal),
                ),
              ).toBe(false);
              invalidationObserved = true;
              signal.throwIfAborted();
              return ok(f.runtime);
            } catch (error) {
              // Production intentionally catches runtime-loader exceptions. Preserve
              // a failed fixture witness so it cannot become a false safe GREEN.
              loaderFailure = { error };
              throw error;
            }
          });
          const result = await executeThreadReadIntent(db, args, f.signal, { loadConnection });
          if (loaderFailure !== undefined) throw loaderFailure.error;
          expect(loadConnection).toHaveBeenCalledTimes(1);
          expect(invalidationObserved).toBe(true);
          expect(committedClaim).toEqual(expect.any(String));
          expect.soft(result.ok).toBe(false);
          expect
            .soft(f.server.state.commands.filter((command) => command === "STORE"))
            .toHaveLength(storesBefore);
          expect.soft(remoteFlags(f)).toEqual(flagsBefore);
          expect.soft(await markers(db, f.threadId)).toEqual(markerBefore);
          const disposition = await observer.query<{
            state: string;
            dispatch_claim: string;
            terminal_at: string | null;
            error_id: string | null;
          }>(
            "SELECT state,dispatch_claim::text,terminal_at::text,error_id FROM email_read_intents WHERE actor_id=$1 AND operation_id=$2",
            [native.actor.id, args.operationId],
          );
          expect(disposition.rows).toHaveLength(1);
          const receipt = disposition.rows[0];
          if (receipt === undefined)
            throw new AppError(ERROR_IDS.DB_INVARIANT, "Read receipt missing");
          expect.soft(["denied", "unknown"]).toContain(receipt.state);
          expect.soft(receipt.dispatch_claim).toBe(committedClaim);
          expect.soft(receipt.error_id).toEqual(expect.any(String));
          expect
            .soft(receipt.terminal_at)
            .toEqual(receipt.state === "denied" ? expect.any(String) : null);
          const barrier = await observer.query<{ unresolved: number }>(
            "SELECT count(*)::integer AS unresolved FROM email_read_intents WHERE actor_id=$1 AND thread_id=$2 AND state IN ('prepared','admitted','unknown')",
            [native.actor.id, f.threadId],
          );
          expect.soft(barrier.rows).toEqual([{ unresolved: receipt.state === "unknown" ? 1 : 0 }]);
          const after = remoteFlags(f);
          const storesAfter = f.server.state.commands.filter(
            (command) => command === "STORE",
          ).length;
          expect(
            await executeThreadReadIntent(db, args, f.signal, { loadConnection }),
          ).toMatchObject({ ok: false });
          expect(loadConnection).toHaveBeenCalledTimes(1);
          expect(remoteFlags(f)).toEqual(after);
          expect(f.server.state.commands.filter((command) => command === "STORE")).toHaveLength(
            storesAfter,
          );
        } finally {
          observer.release();
        }
      } finally {
        await f.server.close();
      }
    });
  },
);
