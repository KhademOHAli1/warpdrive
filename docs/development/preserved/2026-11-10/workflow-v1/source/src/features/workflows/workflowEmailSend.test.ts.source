import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { assert, beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { err } from "@/types/result";
import type { WorkflowDefinition } from "./schemas";
import {
  dispatchWorkflowEmailSend,
  type WorkflowEmailSendNative,
  type WorkflowEmailSendNativeOutcome,
} from "./workflowEmailSend";
import { workflowEmailSendConfig } from "./workflowEmailSendContract";
import {
  planWorkflowEmailSend,
  type WorkflowEmailSendPlan,
  workflowEmailSendRequestKey,
} from "./workflowEmailSendPlan";

const seams = vi.hoisted(() => ({
  resolveBinding: vi.fn(),
  dispatchProofs: new WeakSet<object>(),
}));
vi.mock("./runBindings", () => ({ resolveRunBinding: seams.resolveBinding }));
vi.mock("./workflowExternalEffect", () => ({
  isFreshWorkflowExternalEffectDispatch: (proof: object) => seams.dispatchProofs.has(proof),
  consumeWorkflowExternalEffectDispatch: (proof: object) => seams.dispatchProofs.delete(proof),
}));

const runId = "825c8586-de36-46f1-b008-c33284a12c27";
const dispatchAttemptId = "15629694-761f-4f60-8f29-45f6a419408f";
const accountId = "59fe39a1-d916-40a9-abf9-c22717a0c407";
const actorId = "d1bdc0e0-d0ce-4bf7-89f6-8cdd71c79a53";
const definition: WorkflowDefinition = {
  schemaVersion: 1,
  nodes: [
    { id: "start", name: "Start", type: "trigger.manual", version: 1, config: { scope: "global" } },
  ],
  edges: [],
};
const node = {
  id: "send",
  type: "email.send",
  version: 1,
  config: {
    accountId,
    to: { kind: "value", value: "synthetic-recipient@example.invalid" },
    subject: { kind: "value", value: "Synthetic subject" },
    body: { kind: "value", value: "<b>Synthetic body</b>" },
  },
};
const input = {
  runId,
  node,
  iterationIndex: 2,
  actor: { id: actorId, isActive: true },
  definition,
  outputs: {},
};
const signal = new AbortController().signal;

beforeEach(() => {
  seams.resolveBinding.mockReset();
});

function database(
  rows: readonly { provider: string; connectionGeneration: number }[] = [
    { provider: "gmail", connectionGeneration: 7 },
  ],
) {
  const limit = vi.fn(async () => rows);
  const where = vi.fn((_filter: SQL) => ({ limit }));
  const select = vi.fn(() => ({ from: () => ({ innerJoin: () => ({ where }) }) }));
  return { db: { select } as unknown as Db, where, select };
}

async function planned(db = database().db): Promise<WorkflowEmailSendPlan> {
  const result = await planWorkflowEmailSend(db, input, signal);
  assert(result.ok);
  return result.value.value;
}

function proofFor(plan: WorkflowEmailSendPlan) {
  const proof = Object.freeze({
    executionKey: dispatchAttemptId,
    requestDigest: plan.requestDigest,
  });
  seams.dispatchProofs.add(proof);
  return proof;
}

it("plans private immutable content through the owned, connected, send-capable mailbox projection", async () => {
  const test = database();
  const plan = await planned(test.db);
  expect(plan).toMatchObject({ actorId, accountId, provider: "gmail", connectionGeneration: 7 });
  expect(plan.message).toEqual({
    to: ["synthetic-recipient@example.invalid"],
    cc: [],
    bcc: [],
    subject: "Synthetic subject",
    text: "<b>Synthetic body</b>",
    html: "<p>&lt;b&gt;Synthetic body&lt;/b&gt;</p>",
    visibility: "private",
  });
  expect(Object.isFrozen(plan)).toBe(true);
  expect(Object.isFrozen(plan.message.to)).toBe(true);
  const filter = test.where.mock.calls[0]?.[0];
  assert(filter !== undefined);
  const query = new PgDialect().sqlToQuery(filter);
  expect(query.params).toEqual([
    accountId,
    actorId,
    "connected",
    false,
    true,
    "gmail",
    "imap_smtp",
  ]);
  expect(query.sql).toContain('"users"."invited_at" is null');
  expect(query.sql).toContain('"email_accounts"."capabilities"');
  expect(plan.requestDigest).toMatch(/^[0-9a-f]{64}$/u);
  expect((await planned()).requestDigest).toBe(plan.requestDigest);
});

it("scopes mail replay to the run, node and exact iteration independently of recipient content", async () => {
  const plan = await planned();
  expect(z.uuid({ version: "v8" }).safeParse(plan.idempotencyKey).success).toBe(true);
  expect(workflowEmailSendRequestKey(plan)).toBe(plan.idempotencyKey);
  expect(workflowEmailSendRequestKey({ ...plan, iterationIndex: 3 })).not.toBe(plan.idempotencyKey);
  expect(workflowEmailSendRequestKey({ ...plan, nodeId: "other" })).not.toBe(plan.idempotencyKey);
  const changed = await planWorkflowEmailSend(
    database().db,
    {
      ...input,
      node: {
        ...node,
        config: { ...node.config, body: { kind: "value", value: "Changed content" } },
      },
    },
    signal,
  );
  assert(changed.ok);
  expect(changed.value.value.idempotencyKey).toBe(plan.idempotencyKey);
  expect(changed.value.requestDigest).not.toBe(plan.requestDigest);
});

it("rejects invalid compose and inactive actor before mailbox lookup", async () => {
  const test = database();
  for (const config of [
    { ...node.config, trackOpens: true },
    { ...node.config, subject: { kind: "value", value: "Subject\r\nBcc: forged" } },
    { ...node.config, to: { kind: "value", value: "invalid address" } },
  ]) {
    expect(workflowEmailSendConfig.safeParse(config).success).toBe(false);
    expect(
      await planWorkflowEmailSend(test.db, { ...input, node: { ...node, config } }, signal),
    ).toEqual(err(ERROR_IDS.WORKFLOW_INVALID));
  }
  expect(
    await planWorkflowEmailSend(
      test.db,
      { ...input, actor: { id: actorId, isActive: false } },
      signal,
    ),
  ).toEqual(err(ERROR_IDS.WORKFLOW_DENIED));
  expect(test.select).not.toHaveBeenCalled();
});

it("validates typed mapping before delivering and treats unavailable references as binding errors", async () => {
  const test = database();
  const reference = { kind: "reference", nodeId: "start", path: ["recipient"] };
  const bound = { ...input, node: { ...node, config: { ...node.config, to: reference } } };
  seams.resolveBinding.mockReturnValueOnce({ state: "missing" });
  expect(await planWorkflowEmailSend(test.db, bound, signal)).toEqual(
    err(ERROR_IDS.WORKFLOW_BINDING_MISSING),
  );
  expect(test.select).not.toHaveBeenCalled();
  seams.resolveBinding.mockReturnValueOnce({ state: "value", value: "mapped@example.invalid" });
  const result = await planWorkflowEmailSend(test.db, bound, signal);
  assert(result.ok);
  expect(result.value.value.message.to).toEqual(["mapped@example.invalid"]);
  expect(seams.resolveBinding).toHaveBeenLastCalledWith(
    reference,
    {},
    { definition, nodeId: "send", path: ["to"] },
  );
});

it("denies an unavailable, foreign or unsupported mailbox with the same result", async () => {
  for (const rows of [[], [{ provider: "microsoft", connectionGeneration: 7 }]]) {
    expect(await planWorkflowEmailSend(database(rows).db, input, signal)).toEqual(
      err(ERROR_IDS.MAIL_CONNECTION_UNAVAILABLE),
    );
  }
});

it("requires a fresh, exact external claim and the protected native implementation", async () => {
  const plan = await planned();
  const proof = proofFor(plan);
  const test = database();
  const native = vi.fn<WorkflowEmailSendNative>();
  expect(await dispatchWorkflowEmailSend(test.db, proof, plan, undefined, signal)).toEqual({
    state: "not_sent",
    errorId: ERROR_IDS.WORKFLOW_NOT_READY,
  });
  expect(await dispatchWorkflowEmailSend(test.db, { ...proof }, plan, native, signal)).toEqual({
    state: "not_sent",
    errorId: ERROR_IDS.WORKFLOW_CONFLICT,
  });
  expect(
    await dispatchWorkflowEmailSend(
      test.db,
      proof,
      { ...plan, message: { ...plan.message, subject: "Changed" } },
      native,
      signal,
    ),
  ).toEqual({ state: "not_sent", errorId: ERROR_IDS.WORKFLOW_CONFLICT });
  expect(
    await dispatchWorkflowEmailSend(test.db, proof, plan, native, AbortSignal.abort()),
  ).toEqual({ state: "not_sent", errorId: ERROR_IDS.WORKFLOW_DENIED });
  expect(test.select).not.toHaveBeenCalled();
  expect(native).not.toHaveBeenCalled();
});

it("blocks changed mailbox generation or provider before opening a native send", async () => {
  const plan = await planned();
  const native = vi.fn<WorkflowEmailSendNative>();
  for (const row of [
    { provider: "gmail", connectionGeneration: 8 },
    { provider: "imap_smtp", connectionGeneration: 7 },
  ]) {
    expect(
      await dispatchWorkflowEmailSend(database([row]).db, proofFor(plan), plan, native, signal),
    ).toEqual({ state: "not_sent", errorId: ERROR_IDS.MAIL_CONNECTION_CHANGED });
  }
  expect(native).not.toHaveBeenCalled();
});

it("passes the exact private plan and consumes a competing claim once", async () => {
  const db = database([{ provider: "imap_smtp", connectionGeneration: 3 }]).db;
  const plan = await planned(db);
  const native = vi
    .fn<WorkflowEmailSendNative>()
    .mockResolvedValue({
      disposition: "receipt",
      outcome: {
        status: "sent",
        providerMessageId: "private-provider-id",
        attemptId: "private-mail-attempt-id",
      },
    });
  const proof = proofFor(plan);
  const outcomes = await Promise.all([
    dispatchWorkflowEmailSend(db, proof, plan, native, signal),
    dispatchWorkflowEmailSend(db, proof, plan, native, signal),
  ]);
  expect(native).toHaveBeenCalledExactlyOnceWith(db, { dispatchAttemptId, plan }, signal);
  expect(outcomes).toEqual(
    expect.arrayContaining([
      { state: "complete", output: { status: "accepted" } },
      { state: "not_sent", errorId: ERROR_IDS.WORKFLOW_DENIED },
    ]),
  );
});

it.each<{ outcome: WorkflowEmailSendNativeOutcome; expected: object }>([
  {
    outcome: { disposition: "not_submitted" },
    expected: { state: "not_sent", errorId: ERROR_IDS.MAIL_SEND_REJECTED },
  },
  {
    outcome: {
      disposition: "receipt",
      outcome: { status: "failed", deliveryOutcome: { state: "rejected" } },
    },
    expected: { state: "not_sent", errorId: ERROR_IDS.MAIL_SEND_REJECTED },
  },
  {
    outcome: {
      disposition: "receipt",
      outcome: {
        status: "needs_review",
        deliveryOutcome: { state: "partial", accepted: ["private@example.invalid"] },
      },
    },
    expected: { state: "complete", errorId: ERROR_IDS.MAIL_WRITE_PARTIAL },
  },
  {
    outcome: {
      disposition: "receipt",
      outcome: { status: "needs_review", deliveryOutcome: { state: "accepted" } },
    },
    expected: { state: "complete", output: { status: "accepted" } },
  },
  {
    outcome: { disposition: "receipt", outcome: { status: "pending" } },
    expected: { state: "unknown", errorId: ERROR_IDS.MAIL_SEND_UNKNOWN },
  },
  {
    outcome: { disposition: "unknown" },
    expected: { state: "unknown", errorId: ERROR_IDS.MAIL_SEND_UNKNOWN },
  },
])("projects native receipts without private delivery data", async ({ outcome, expected }) => {
  const plan = await planned();
  const native = vi.fn<WorkflowEmailSendNative>().mockResolvedValue(outcome);
  expect(
    await dispatchWorkflowEmailSend(database().db, proofFor(plan), plan, native, signal),
  ).toEqual(expected);
});

it("treats a thrown native error as an unknown delivery without leaking private data", async () => {
  const plan = await planned();
  const native = vi
    .fn<WorkflowEmailSendNative>()
    .mockRejectedValue(new Error("private@example.invalid: private message"));
  expect(
    await dispatchWorkflowEmailSend(database().db, proofFor(plan), plan, native, signal),
  ).toEqual({ state: "unknown", errorId: ERROR_IDS.MAIL_SEND_UNKNOWN });
  expect(native).toHaveBeenCalledTimes(1);
});
