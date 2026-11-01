import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool, PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { users } from "@/db/schema/identity";
import { makeTestDb } from "@/test/db";
import { ok } from "@/types/result";
import { runAuthorityTransactionCandidate } from "./authorityTransactionCandidate";
import {
  boundaryUser,
  connectionBoundarySpec,
  observe,
  type Observed,
  readOwnConfiguration,
  releaseRemainingClients,
  rollbackAndRelease,
  waitForBoundarySettlement,
  waitForQueuedOrSettled,
} from "./authorityConnectionBoundary.test-support";

describe("real-PG authority connection ownership boundary", () => {
  it("rejects a borrowed Drizzle wrapper without changing its outer repeatable-read transaction", async () => {
    const h = await makeTestDb();
    let client: PoolClient | undefined;
    try {
      const actorId = randomUUID();
      const sentinelId = randomUUID();
      await h.db.insert(users).values(boundaryUser(actorId, "before"));
      client = await h.pool.connect();
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
      const before = await client.query<{ active: boolean }>(
        "SELECT is_active AS active FROM users WHERE id = $1", [actorId],
      );
      expect(before.rows).toEqual([{ active: true }]);
      await h.db.update(users).set({ isActive: false }).where(eq(users.id, actorId));
      await client.query(
        "INSERT INTO users (id, email, name, is_active) VALUES ($1, $2, $3, true)",
        [sentinelId, `boundary-${sentinelId}@synthetic.invalid`, "outer_uncommitted"],
      );

      let entered = false;
      const borrowed = drizzle(client, { schema });
      const result = await runAuthorityTransactionCandidate(
        borrowed as unknown as Pool,
        connectionBoundarySpec(),
        new AbortController().signal,
        async () => {
          entered = true;
          return ok("must_not_enter");
        },
      );
      expect(result).toEqual({ ok: false, error: "authority_transaction_unavailable" });
      expect(entered).toBe(false);
      expect((await client.query("SHOW transaction_isolation")).rows)
        .toEqual([{ transaction_isolation: "repeatable read" }]);
      expect((await client.query("SELECT is_active AS active FROM users WHERE id = $1", [actorId])).rows)
        .toEqual([{ active: true }]);
      expect((await client.query("SELECT id FROM users WHERE id = $1", [sentinelId])).rows)
        .toEqual([{ id: sentinelId }]);
      expect(await h.db.select({ active: users.isActive }).from(users).where(eq(users.id, actorId)))
        .toEqual([{ active: false }]);
      expect(await h.db.select({ id: users.id }).from(users).where(eq(users.id, sentinelId))).toEqual([]);
    } finally {
      try {
        if (client !== undefined) await rollbackAndRelease(client);
      } finally {
        await h.close();
      }
    }
  });

  it("captures one key, mode and timeout snapshot before delayed Pool acquisition", async () => {
    const h = await makeTestDb();
    const held: PoolClient[] = [];
    let settled: Promise<Observed<unknown>> | undefined;
    try {
      for (let index = 0; index < 4; index += 1) held.push(await h.pool.connect());
      const spec = connectionBoundarySpec();
      const original = structuredClone(spec);
      settled = observe(runAuthorityTransactionCandidate(
        h.pool, spec, new AbortController().signal, readOwnConfiguration,
      ));
      expect(await waitForQueuedOrSettled(h.pool, settled)).toEqual({ kind: "queued" });

      spec.key[0] += 1;
      spec.key[1] += 1;
      spec.mode = "exclusive";
      spec.sqlTimeouts.lockMs = 2_500;
      spec.sqlTimeouts.statementMs = 4_500;
      spec.sqlTimeouts.idleMs = 6_500;
      const released = held.shift();
      expect(released).toBeDefined();
      if (released === undefined) return;
      released.release();

      expect(await waitForBoundarySettlement(settled)).toEqual({
        kind: "finished",
        value: ok({
          settings: { isolation: "read committed", ...original.sqlTimeouts },
          locks: [{
            keyFirst: String(original.key[0]),
            keySecond: String(original.key[1]),
            keySpace: 2,
            mode: "ShareLock",
            granted: true,
          }],
        }),
      });
    } finally {
      try {
        const released = await releaseRemainingClients(held);
        expect(released.every((result) => result.status === "fulfilled")).toBe(true);
      } finally {
        try {
          if (settled !== undefined) await settled;
        } finally {
          await h.close();
        }
      }
    }
  });
});
