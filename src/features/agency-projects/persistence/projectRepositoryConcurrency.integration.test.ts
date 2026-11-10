import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import type { TestDb } from "@/test/db";
import { projectCreateInputSchema } from "../projectCreationInput";
import { type ProjectSchemaFixture, schemaCase } from "./projectPersistence.seeds";
import { repositoryFixture, success } from "./projectRepository.test-support";

function input(f: ProjectSchemaFixture) {
  return projectCreateInputSchema.parse({
    intentId: randomUUID(),
    ownerUserId: f.ownerId,
    title: "Concurrent studio / همزمان",
    dealId: null,
    personId: null,
    orgId: f.orgId,
  });
}

type TestLock = { kind: "intent"; key: string } | { kind: "project"; projectId: string };

async function waitForBlockedTransactions(holder: PoolClient, signal: AbortSignal) {
  const deadline = performance.now() + 2_000;
  while (performance.now() < deadline) {
    signal.throwIfAborted();
    const reset = {
      text: "SELECT pg_stat_clear_snapshot()",
      query_timeout: Math.max(1, Math.ceil(deadline - performance.now())),
    };
    await holder.query(reset);
    signal.throwIfAborted();
    const remaining = deadline - performance.now();
    if (remaining <= 0) break;
    const query = {
      text: `WITH RECURSIVE activity AS MATERIALIZED (
        SELECT pid,pg_blocking_pids(pid) AS blockers FROM pg_stat_activity
        WHERE datname=current_database() AND pid<>pg_backend_pid()
      ), blocked(pid) AS (
        SELECT pid FROM activity WHERE pg_backend_pid()=ANY(blockers)
        UNION
        SELECT a.pid FROM activity a JOIN blocked b ON b.pid=ANY(a.blockers)
      ) SELECT count(*)::int AS blocked FROM blocked`,
      query_timeout: Math.max(1, Math.ceil(remaining)),
    };
    const result = await holder.query<{ blocked: number }>(query);
    signal.throwIfAborted();
    if ((result.rows[0]?.blocked ?? 0) >= 2) return;
    const pause = Math.min(20, deadline - performance.now());
    if (pause > 0) await delay(pause, undefined, { signal });
  }
  signal.throwIfAborted();
  throw new Error("Expected two repository transactions blocked by the held test lock");
}

// Test barriers only. This holder does not supply the missing production authority fence.
async function blockedBatch<T>(
  db: TestDb,
  lock: TestLock,
  work: ReadonlyArray<() => Promise<T>>,
  signal: AbortSignal,
): Promise<T[]> {
  signal.throwIfAborted();
  const holder = await db.pool.connect();
  let pending: Promise<PromiseSettledResult<T>[]> | undefined;
  try {
    signal.throwIfAborted();
    await holder.query("BEGIN");
    signal.throwIfAborted();
    await holder.query("SET LOCAL statement_timeout='2s'");
    signal.throwIfAborted();
    await holder.query(
      lock.kind === "intent"
        ? { text: "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", values: [lock.key] }
        : {
            text: "SELECT id FROM agency_projects WHERE id=$1 FOR UPDATE",
            values: [lock.projectId],
          },
    );
    signal.throwIfAborted();
    // The holder leaves three pool clients for real repository transactions. Attach all handlers
    // immediately and drain every command even when the witness or an individual command fails.
    pending = Promise.allSettled(work.map((operation) => Promise.resolve().then(operation)));
    await waitForBlockedTransactions(holder, signal);
  } finally {
    let discard = true;
    try {
      // Cleanup must release the test lock even after cancellation or a failed witness.
      await holder.query("ROLLBACK");
      discard = false;
    } finally {
      holder.release(discard);
      if (pending !== undefined) await pending;
    }
  }
  signal.throwIfAborted();
  const settled = await pending;
  signal.throwIfAborted();
  return settled.map((result) => {
    if (result.status === "rejected") throw result.reason;
    return result.value;
  });
}

async function persisted(db: TestDb, signal: AbortSignal) {
  signal.throwIfAborted();
  const counts = await db.pool.query<{
    projects: string;
    members: string;
    history: string;
    requests: string;
  }>(
    "SELECT (SELECT count(*) FROM agency_projects)::text AS projects,(SELECT count(*) FROM agency_project_members)::text AS members,(SELECT count(*) FROM agency_project_history)::text AS history,(SELECT count(*) FROM agency_project_requests)::text AS requests",
  );
  signal.throwIfAborted();
  const members = await db.pool.query<{
    project_id: string;
    user_id: string;
    project_edit: boolean;
    assignment_coordinate: boolean;
  }>("SELECT project_id,user_id,project_edit,assignment_coordinate FROM agency_project_members");
  signal.throwIfAborted();
  const history = await db.pool.query<{
    id: string;
    project_id: string;
    recorded_by_user_id: string;
    operation: string;
    revision: string;
    state: string;
  }>(
    "SELECT id,project_id,recorded_by_user_id,operation,revision::text,state FROM agency_project_history ORDER BY revision",
  );
  signal.throwIfAborted();
  const requests = await db.pool.query<{
    actor_user_id: string;
    operation: string;
    intent_id: string;
    project_id: string;
    result_revision: string;
    history_id: string;
  }>(
    "SELECT actor_user_id,operation,intent_id,project_id,result_revision::text,history_id FROM agency_project_requests ORDER BY result_revision",
  );
  signal.throwIfAborted();
  return {
    counts: counts.rows[0],
    members: members.rows,
    history: history.rows,
    requests: requests.rows,
  };
}

// Real-PG contention with injected admissions and a synthetic codec, not native authority/crypto proof.
describe("private Agency repository concurrency", () => {
  it(
    "serializes eight identical create intents into one exact receipt and one execution",
    schemaCase(async (f) => {
      const { repository, calls } = repositoryFixture(f);
      const command = input(f);
      const outcomes = await blockedBatch(
        f.db,
        { kind: "intent", key: `agency-project-request:${f.actorId}:create:${command.intentId}` },
        Array.from({ length: 8 }, () => () => repository.create(command, f.signal)),
        f.signal,
      );
      const first = outcomes[0];
      assert(first);
      const receipt = success(first);
      expect(outcomes).toEqual(Array.from({ length: 8 }, () => ({ ok: true, value: receipt })));
      expect(calls.transactions).toBe(8);
      expect(receipt.revision).toBe(0);
      const rows = await persisted(f.db, f.signal);
      expect(rows.counts).toEqual({ projects: "1", members: "1", history: "1", requests: "1" });
      expect(rows.members).toEqual([
        {
          project_id: receipt.projectId,
          user_id: f.actorId,
          project_edit: true,
          assignment_coordinate: false,
        },
      ]);
      expect(rows.history).toMatchObject([
        {
          project_id: receipt.projectId,
          recorded_by_user_id: f.actorId,
          operation: "create",
          revision: "0",
          state: "planned",
        },
      ]);
      expect(rows.requests).toMatchObject([
        {
          actor_user_id: f.actorId,
          operation: "create",
          intent_id: command.intentId,
          project_id: receipt.projectId,
          result_revision: "0",
        },
      ]);
      expect(rows.requests.map((row) => row.history_id)).toEqual(rows.history.map((row) => row.id));
      expect(success(await repository.read(receipt.projectId, f.signal))).toMatchObject({
        state: "planned",
        revision: 0,
      });
    }),
  );

  it(
    "allows one of eight distinct revision-zero starts and rejects the seven stale intents",
    schemaCase(async (f) => {
      const { repository } = repositoryFixture(f);
      const createCommand = input(f);
      const created = success(await repository.create(createCommand, f.signal));
      const commands = Array.from({ length: 8 }, () => ({
        projectId: created.projectId,
        intentId: randomUUID(),
        expectedRevision: 0,
      }));
      const outcomes = await blockedBatch(
        f.db,
        { kind: "project", projectId: created.projectId },
        commands.map((command) => () => repository.start(command, f.signal)),
        f.signal,
      );
      expect(outcomes.filter((result) => result.ok)).toEqual([
        { ok: true, value: { projectId: created.projectId, revision: 1 } },
      ]);
      expect(outcomes.filter((result) => !result.ok)).toEqual(
        Array.from({ length: 7 }, () => ({ ok: false, error: "revision_conflict" })),
      );
      const winner = commands[outcomes.findIndex((result) => result.ok)];
      assert(winner);
      expect(success(await repository.read(created.projectId, f.signal))).toMatchObject({
        state: "active",
        revision: 1,
      });
      const rows = await persisted(f.db, f.signal);
      expect(rows.counts).toEqual({ projects: "1", members: "1", history: "2", requests: "2" });
      const recorded = { project_id: created.projectId, recorded_by_user_id: f.actorId };
      expect(rows.history).toMatchObject([
        { ...recorded, operation: "create", revision: "0", state: "planned" },
        { ...recorded, operation: "start", revision: "1", state: "active" },
      ]);
      const requested = { actor_user_id: f.actorId, project_id: created.projectId };
      expect(rows.requests).toMatchObject([
        {
          ...requested,
          operation: "create",
          intent_id: createCommand.intentId,
          result_revision: "0",
        },
        {
          ...requested,
          operation: "start",
          intent_id: winner.intentId,
          result_revision: "1",
        },
      ]);
      expect(rows.requests.map((row) => row.history_id)).toEqual(rows.history.map((row) => row.id));
    }),
  );
});
