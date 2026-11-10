import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { assert, beforeEach, expect, it, vi } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { workflowRuns } from "@/db/schema/workflowExecutions";
import { workflowExternalEffects } from "@/db/schema/workflowExternalEffects";
import { workflows, workflowVersions } from "@/db/schema/workflows";
import { hydrateActor } from "@/server/hydrateActor";
import { err, ok } from "@/types/result";
import type { WorkflowDefinition } from "./schemas";
import {
  authorizeWorkflowExternalEffect,
  claimWorkflowExternalEffect,
  completeWorkflowExternalEffect,
  consumeWorkflowExternalEffectDispatch,
  isFreshWorkflowExternalEffectDispatch,
  isWorkflowExternalEffectDispatch,
  recoverWorkflowExternalEffect,
  type WorkflowExternalEffect,
  type WorkflowExternalEffectTx,
  workflowExternalEffectMaxDispatchAgeMs,
} from "./workflowExternalEffect";
import {
  workflowExternalEffectAbandonAfterMs,
  workflowExternalEffectCompletion,
} from "./workflowExternalEffectContract";

vi.mock("@/server/hydrateActor", () => ({ hydrateActor: vi.fn() }));

const runId = "70668f93-dcd9-4b4e-b69f-54cc088379cc";
const actorId = "9ace507f-178c-45ab-b7c5-8fd442cc29fa";
const attemptId = "65a35b00-dfef-4cc4-a2a8-287f4e18d15b";
const workflowId = "62d5d019-448c-4d51-a1e8-b6f33774a85a";
const versionId = "d15648f8-1806-4336-b585-5c06fd0cc557";
const digest = "a".repeat(64);
const identity = { runId, nodeId: "effect", iterationIndex: -1, kind: "record.read" };
const signal = new AbortController().signal;
const workflow = { id: workflowId, ownerId: actorId, archivedAt: null };
const definition: WorkflowDefinition = {
  schemaVersion: 1,
  nodes: [{ id: "effect", type: "record.read", version: 1, name: "Pinned effect", config: {} }],
  edges: [],
};

beforeEach(() => {
  vi.mocked(hydrateActor).mockResolvedValue({
    id: actorId,
    type: "admin",
    isActive: true,
    flags: new Set(),
    groupIds: new Set(),
    name: "Synthetic worker",
    email: "worker@example.test",
    avatarUrl: null,
  });
});

type Run = typeof workflowRuns.$inferSelect;
type Insert = Pick<
  WorkflowExternalEffect,
  "runId" | "nodeId" | "iterationIndex" | "kind" | "requestDigest"
>;

function setup(overrides: Partial<Run> = {}) {
  const run = {
    id: runId,
    workflowId,
    versionId,
    actorId,
    status: "running",
    mode: "live",
    nextNodeId: identity.nodeId,
    iteratorFrame: null,
    ...overrides,
  };
  const operations: string[] = [];
  let row: WorkflowExternalEffect | undefined;
  const queries: string[] = [];
  const dialect = new PgDialect();
  function record(condition: SQL | undefined) {
    const query = condition === undefined ? "" : dialect.sqlToQuery(condition).sql;
    queries.push(query);
    return query;
  }
  const lock = vi.fn((mode: string) => {
    operations.push(`lock ${mode}`);
    return Promise.resolve([run]);
  });
  const insert = vi.fn((fields: Insert) => {
    operations.push("insert");
    if (row !== undefined) return Promise.resolve([]);
    row = {
      ...fields,
      attemptId,
      state: "started",
      startedAt: new Date(),
      dispatchAuthorizedAt: null,
      finishedAt: null,
      output: null,
      errorId: null,
    };
    return Promise.resolve([row]);
  });
  const tx = {
    select: (projection?: unknown) => ({
      from: (table: unknown) => ({
        where: (condition?: SQL) => {
          record(condition);
          if (table === workflowRuns) return { for: lock };
          if (table === workflows) return Promise.resolve([workflow]);
          if (table === workflowVersions) return Promise.resolve([{ definition }]);
          assert(table === workflowExternalEffects);
          const visible =
            row !== undefined &&
            (projection === undefined ||
              (row.state === "started" && row.dispatchAuthorizedAt === null));
          return Promise.resolve(visible ? [row] : []);
        },
      }),
    }),
    insert: () => ({
      values: (fields: Insert) => ({
        onConflictDoNothing: () => ({ returning: () => insert(fields) }),
      }),
    }),
    update: () => ({
      set: (patch: Partial<WorkflowExternalEffect>) => ({
        where: (condition?: SQL) => {
          const query = record(condition);
          return {
            returning: () => {
              if (row?.state !== "started") return Promise.resolve([]);
              if (patch.dispatchAuthorizedAt !== undefined) {
                if (row.dispatchAuthorizedAt !== null) return Promise.resolve([]);
                row = { ...row, dispatchAuthorizedAt: new Date() };
              } else {
                const since = (row.dispatchAuthorizedAt ?? row.startedAt).getTime();
                if (
                  query.includes(" <= ") &&
                  Date.now() - since < workflowExternalEffectAbandonAfterMs
                )
                  return Promise.resolve([]);
                if (query.includes("is not null") && row.dispatchAuthorizedAt === null)
                  return Promise.resolve([]);
                row = { ...row, ...patch, finishedAt: new Date() };
              }
              return Promise.resolve([row]);
            },
          };
        },
      }),
    }),
  } as unknown as WorkflowExternalEffectTx;
  const db = {
    transaction: (work: (session: WorkflowExternalEffectTx) => unknown) => work(tx),
  } as unknown as Db;
  const expire = () => {
    assert(row !== undefined);
    const time = new Date(Date.now() - workflowExternalEffectAbandonAfterMs - 1_000);
    row = {
      ...row,
      startedAt: time,
      dispatchAuthorizedAt: row.dispatchAuthorizedAt === null ? null : time,
    };
  };
  return { tx, db, operations, queries, expire, insert, row: () => row };
}

async function acquire(tx: WorkflowExternalEffectTx) {
  const result = await claimWorkflowExternalEffect(tx, identity, digest, signal);
  assert(result.ok && result.value.state === "acquired", JSON.stringify(result));
  return result.value.claim;
}

it("locks the current live cursor before inserting and never reissues an observed claim", async () => {
  const fixture = setup();
  const acquired = await acquire(fixture.tx);
  expect(fixture.operations.slice(0, 2)).toEqual(["lock update", "insert"]);
  expect(acquired).toMatchObject({ attemptId, requestDigest: digest, identity });
  expect(await claimWorkflowExternalEffect(fixture.tx, identity, digest, signal)).toMatchObject({
    ok: true,
    value: { state: "observed", effect: { attemptId, state: "started" } },
  });
  expect(await claimWorkflowExternalEffect(fixture.tx, identity, "b".repeat(64), signal)).toEqual(
    err(ERROR_IDS.WORKFLOW_CONFLICT),
  );
  expect(
    await authorizeWorkflowExternalEffect(
      fixture.db,
      { ...acquired },
      () => ok({ requestDigest: digest, value: null }),
      signal,
    ),
  ).toEqual(err(ERROR_IDS.WORKFLOW_DENIED));
});

it.each<Partial<Run>>([
  { mode: "simulation" },
  { nextNodeId: "different" },
  { status: "cancelled" },
  {
    iteratorFrame: {
      version: 1,
      iteratorNodeId: "loop",
      itemIndex: 0,
      itemCount: 2,
      failedCount: 0,
    },
  },
])(
  "denies a stale, simulated or mismatched iteration cursor without claiming",
  async (overrides) => {
    const { tx, insert } = setup(overrides);
    expect(await claimWorkflowExternalEffect(tx, identity, digest, signal)).toEqual(
      err(ERROR_IDS.WORKFLOW_DENIED),
    );
    expect(insert).not.toHaveBeenCalled();
  },
);

it("rechecks native authority and pinned plan before issuing a fresh one-use dispatch proof", async () => {
  const { tx, db, queries } = setup();
  const claimed = await acquire(tx);
  const reauthorize = vi.fn(() =>
    ok({ requestDigest: digest, value: { operatorCredential: "ephemeral" } }),
  );
  const accepted = await authorizeWorkflowExternalEffect(db, claimed, reauthorize, signal);
  assert(accepted.ok, JSON.stringify(accepted));
  const { dispatch, value: ephemeral } = accepted.value;
  expect(reauthorize).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      actor: expect.objectContaining({ id: actorId }),
      node: definition.nodes[0],
      definition,
    }),
  );
  expect(ephemeral.operatorCredential).toBe("ephemeral");
  expect(JSON.stringify(dispatch)).not.toContain("ephemeral");
  expect(dispatch.executionKey).toBe(attemptId);
  expect(isWorkflowExternalEffectDispatch({ ...dispatch })).toBe(false);
  const stamp = dispatch.dispatchAuthorizedAt.getTime();
  expect(isFreshWorkflowExternalEffectDispatch(dispatch, stamp - 5_001)).toBe(false);
  expect(
    isFreshWorkflowExternalEffectDispatch(
      dispatch,
      stamp + workflowExternalEffectMaxDispatchAgeMs + 1,
    ),
  ).toBe(false);
  expect(isFreshWorkflowExternalEffectDispatch(dispatch, stamp + 1)).toBe(true);
  expect(consumeWorkflowExternalEffectDispatch(dispatch)).toBe(true);
  expect(consumeWorkflowExternalEffectDispatch(dispatch)).toBe(false);
  expect(await authorizeWorkflowExternalEffect(db, claimed, reauthorize, signal)).toEqual(
    err(ERROR_IDS.WORKFLOW_CONFLICT),
  );
  expect(
    queries.some(
      (query) =>
        query.includes('"dispatch_authorized_at" is null') && query.includes('"started_at" >'),
    ),
  ).toBe(true);
});

it("seals no-send on revocation and does not authorize a settled attempt", async () => {
  const { tx, db, row } = setup();
  const claim = await acquire(tx);
  const reauthorize = vi.fn(() => ok({ requestDigest: digest, value: null }));
  vi.mocked(hydrateActor).mockResolvedValueOnce(null);
  expect(await authorizeWorkflowExternalEffect(db, claim, reauthorize, signal)).toEqual(
    err(ERROR_IDS.WORKFLOW_DENIED),
  );
  expect(reauthorize).not.toHaveBeenCalled();
  expect(
    await completeWorkflowExternalEffect(
      tx,
      claim,
      { state: "not_sent", errorId: ERROR_IDS.WORKFLOW_DENIED },
      signal,
    ),
  ).toMatchObject({ ok: true, value: { state: "not_sent", output: null } });
  expect(row()?.dispatchAuthorizedAt).toBeNull();
  expect(await authorizeWorkflowExternalEffect(db, claim, reauthorize, signal)).toEqual(
    err(ERROR_IDS.WORKFLOW_CONFLICT),
  );
});

it("requires a dispatch stamp for completion and preserves the first terminal receipt", async () => {
  const { tx, db, row } = setup();
  const claim = await acquire(tx);
  const result = { state: "complete", output: { status: 200, "result.ok": true } } as const;
  expect(await completeWorkflowExternalEffect(tx, claim, result, signal)).toEqual(
    err(ERROR_IDS.WORKFLOW_CONFLICT),
  );
  expect(
    await authorizeWorkflowExternalEffect(
      db,
      claim,
      () => ok({ requestDigest: "b".repeat(64), value: null }),
      signal,
    ),
  ).toEqual(err(ERROR_IDS.WORKFLOW_CONFLICT));
  expect(
    (
      await authorizeWorkflowExternalEffect(
        db,
        claim,
        () => ok({ requestDigest: digest, value: null }),
        signal,
      )
    ).ok,
  ).toBe(true);
  expect(await completeWorkflowExternalEffect(tx, claim, result, signal)).toMatchObject({
    ok: true,
    value: result,
  });
  expect(
    await completeWorkflowExternalEffect(
      tx,
      claim,
      { state: "unknown", errorId: ERROR_IDS.WORKFLOW_NOT_READY },
      signal,
    ),
  ).toEqual(err(ERROR_IDS.WORKFLOW_CONFLICT));
  expect(row()).toMatchObject(result);
});

it.each([false, true])(
  "observes a fresh claim and conservatively seals an abandoned attempt (armed %s)",
  async (armed) => {
    const { tx, db, expire } = setup();
    const claim = await acquire(tx);
    if (armed)
      expect(
        (
          await authorizeWorkflowExternalEffect(
            db,
            claim,
            () => ok({ requestDigest: digest, value: null }),
            signal,
          )
        ).ok,
      ).toBe(true);
    expect(await recoverWorkflowExternalEffect(tx, identity, signal)).toMatchObject({
      ok: true,
      value: { state: "started" },
    });
    expire();
    const state = armed ? "unknown" : "not_sent";
    expect(await recoverWorkflowExternalEffect(tx, identity, signal)).toMatchObject({
      ok: true,
      value: { state, output: null },
    });
    expect(await claimWorkflowExternalEffect(tx, identity, digest, signal)).toMatchObject({
      ok: true,
      value: { state: "observed", effect: { state } },
    });
  },
);

it("bounds output and rejects raw bodies, headers and provider diagnostics", () => {
  for (const output of [
    { headers: "raw" },
    { status: { value: 200 } },
    { "result.x": "x".repeat(4097) },
    { "result.x": "\0" },
  ]) {
    expect(workflowExternalEffectCompletion.safeParse({ state: "complete", output }).success).toBe(
      false,
    );
  }
  expect(
    workflowExternalEffectCompletion.safeParse({
      state: "unknown",
      errorId: "provider error and credential",
    }).success,
  ).toBe(false);
});
