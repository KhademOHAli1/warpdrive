import { type SQL, TransactionRollbackError } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { assert, beforeEach, expect, it, vi } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { workflowRuns, workflowSteps, workflows, workflowVersions } from "@/db/schema";
import type { PermSetUser } from "@/features/permissions/effective";
import { err, ok } from "@/types/result";
import type { StepOutput } from "./runTypes";
import type { WorkflowDefinition } from "./schemas";
import { submitWorkflowHumanForm } from "./workflowHumanFormSubmit";

const access = vi.hoisted(() => ({ sessionActor: vi.fn(), referenceVisible: vi.fn() }));
vi.mock("./runRetrySession", () => ({ currentRetryActor: access.sessionActor }));
vi.mock("@/features/permissions/referenceCheck", () => ({
  assertReferenceVisible: access.referenceVisible,
}));

const workflowId = "15629694-761f-4f60-8f29-45f6a419408f";
const runId = "825c8586-de36-46f1-b008-c33284a12c27";
const versionId = "59fe39a1-d916-40a9-abf9-c22717a0c407";
const recordId = "c90b7e40-9b70-4804-8f35-5bd3404fac63";
const requestKey = "98a6b686-ddd4-42c1-9462-f55279e2106d";
const textId = "6f1627fd-ad60-4899-b15e-b8b824f0338a";
const numberId = "968939b6-9015-4001-9f9d-f24a8ad4ebcf";
const who = {
  userId: "d1bdc0e0-d0ce-4bf7-89f6-8cdd71c79a53",
  sessionId: "e30417fb-fdc1-4d00-9109-25125f5a8c91",
};
const actor: PermSetUser = {
  id: who.userId,
  isActive: true,
  type: "regular",
  flags: new Set(["workflow.view", "workflow.run"]),
  groupIds: new Set(),
};
const definition: WorkflowDefinition = {
  schemaVersion: 1,
  nodes: [
    { id: "start", type: "trigger.manual", name: "Start", version: 1, config: {} },
    {
      id: "form",
      type: "human.form",
      name: "Collect input",
      version: 1,
      config: {
        fields: [
          { id: textId, label: "Comment", type: "text", required: false },
          { id: numberId, label: "Quantity", type: "number", required: true },
        ],
      },
    },
    {
      id: "next",
      type: "record.read",
      name: "Read deal",
      version: 1,
      config: { entity: "deal", recordId: { kind: "value", value: recordId } },
    },
  ],
  edges: [
    { from: "start", to: "form", port: "next" },
    { from: "form", to: "next", port: "next" },
  ],
};
type Run = Pick<
  typeof workflowRuns.$inferSelect,
  | "id"
  | "workflowId"
  | "versionId"
  | "actorId"
  | "mode"
  | "status"
  | "nextNodeId"
  | "resumeAt"
  | "outputs"
  | "trigger"
>;
const completedAt = new Date("2031-01-01T10:00:00Z");
const waitingRun: Run = {
  id: runId,
  workflowId,
  versionId,
  actorId: who.userId,
  mode: "live",
  status: "waiting",
  nextNodeId: "form",
  resumeAt: new Date("2031-01-01T11:00:00Z"),
  outputs: { start: { recordId } },
  trigger: { recordId },
};
const input = {
  workflowId,
  runId,
  nodeId: "form",
  requestKey,
  answers: { [numberId]: 0 },
};
const answers = { [`answers.${textId}`]: null, [`answers.${numberId}`]: 0 };
const receipt = { output: { ...answers, _formSubmission: { requestKey } }, simulated: false };
const signal = new AbortController().signal;

beforeEach(() => {
  vi.resetAllMocks();
  access.sessionActor.mockResolvedValue(actor);
  access.referenceVisible.mockResolvedValue(ok(undefined));
});

function database({
  run = waitingRun,
  step,
  pinnedDefinition = definition,
}: {
  run?: Run | null;
  step?: { output: StepOutput; simulated: boolean };
  pinnedDefinition?: WorkflowDefinition;
} = {}) {
  const rows = new Map<object, unknown[]>([
    [workflowRuns, run === null ? [] : [run]],
    [workflows, [{ ownerId: who.userId, archivedAt: null, active: false }]],
    [workflowVersions, [{ definition: pinnedDefinition }]],
    [workflowSteps, step === undefined ? [] : [step]],
  ]);
  const locked = vi.fn<(table: object, mode: string) => void>();
  const filters = new Map<object, SQL>();
  const select = () => ({
    from: (table: object) => ({
      where: (predicate: SQL) => {
        filters.set(table, predicate);
        const result = Promise.resolve(rows.get(table) ?? []);
        return Object.assign(result, {
          for: (mode: string) => {
            locked(table, mode);
            return result;
          },
        });
      },
    }),
  });
  const returning = vi.fn().mockResolvedValue([{ updatedAt: completedAt }]);
  const updateWhere = vi.fn<(predicate: SQL) => { returning: typeof returning }>(() => ({
    returning,
  }));
  const set = vi.fn<(patch: Record<string, unknown>) => { where: typeof updateWhere }>(() => ({
    where: updateWhere,
  }));
  const insert = vi
    .fn<(row: typeof workflowSteps.$inferInsert) => Promise<void>>()
    .mockResolvedValue(undefined);
  const rollback = vi.fn(() => {
    throw new TransactionRollbackError();
  });
  const tx = { select, update: () => ({ set }), insert: () => ({ values: insert }), rollback };
  const transaction = vi.fn((operation: (transaction: Db) => Promise<unknown>) =>
    operation(tx as unknown as Db),
  );
  return {
    db: { transaction } as unknown as Db,
    filters,
    locked,
    updateWhere,
    set,
    returning,
    insert,
    rollback,
  };
}

it("checks the live session twice and uses no Deal lookup for a pinned Global form", async () => {
  const test = database({
    run: { ...waitingRun, trigger: { scope: "global" } },
    pinnedDefinition: {
      ...definition,
      nodes: definition.nodes.map((node) =>
        node.type === "trigger.manual" ? { ...node, config: { scope: "global" } } : node,
      ),
    },
  });
  expect(await submitWorkflowHumanForm(test.db, who, input, signal)).toEqual(
    ok({ id: runId, replayed: false }),
  );
  expect(access.sessionActor).toHaveBeenCalledTimes(2);
  expect(access.referenceVisible).not.toHaveBeenCalled();
});

it("does not treat a Global-shaped payload as recordless on a pinned Deal form", async () => {
  const test = database({ run: { ...waitingRun, trigger: { scope: "global" } } });
  expect(await submitWorkflowHumanForm(test.db, who, input, signal)).toEqual(
    err(ERROR_IDS.WORKFLOW_INVALID),
  );
  expect(test.set).not.toHaveBeenCalled();
  expect(test.insert).not.toHaveBeenCalled();
});

it("uses the locked run and database deadline, advancing once with a private replay receipt", async () => {
  const test = database();
  expect(await submitWorkflowHumanForm(test.db, who, input, signal)).toEqual(
    ok({ id: runId, replayed: false }),
  );
  expect(test.locked).toHaveBeenNthCalledWith(1, workflowRuns, "update");
  expect(test.locked).toHaveBeenNthCalledWith(2, workflows, "share");
  const lockedAt = test.locked.mock.invocationCallOrder[0];
  const checkedAt = access.sessionActor.mock.invocationCallOrder[0];
  assert(lockedAt !== undefined && checkedAt !== undefined);
  expect(lockedAt).toBeLessThan(checkedAt);
  const runFilter = test.filters.get(workflowRuns);
  const deadlineFilter = test.updateWhere.mock.calls[0]?.[0];
  assert(runFilter !== undefined && deadlineFilter !== undefined);
  const dialect = new PgDialect();
  expect(dialect.sqlToQuery(runFilter).params).toEqual([runId, workflowId, who.userId]);
  expect(dialect.sqlToQuery(deadlineFilter).sql).toContain('"resume_at" > clock_timestamp()');
  expect(test.set).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      status: "running",
      nextNodeId: "next",
      resumeAt: null,
      outputs: { ...waitingRun.outputs, form: answers },
    }),
  );
  expect(test.insert).toHaveBeenCalledExactlyOnceWith({
    runId,
    nodeId: "form",
    ...receipt,
    completedAt,
  });
  expect(access.sessionActor).toHaveBeenCalledTimes(2);
});

it("acknowledges the same canonical answers after later cancellation without any write", async () => {
  const test = database({
    run: { ...waitingRun, status: "cancelled", resumeAt: null, nextNodeId: "next" },
    step: receipt,
  });
  const replay = {
    ...input,
    requestKey: requestKey.toUpperCase(),
    answers: { [textId]: "", [numberId]: 0 },
  };
  expect(await submitWorkflowHumanForm(test.db, who, replay, signal)).toEqual(
    ok({ id: runId, replayed: true }),
  );
  expect(test.set).not.toHaveBeenCalled();
  expect(test.insert).not.toHaveBeenCalled();
});

it.each([
  { ...input, requestKey: versionId },
  { ...input, answers: { [numberId]: 1 } },
])("refuses to replace a completed submission", async (change) => {
  const test = database({ step: receipt });
  expect(await submitWorkflowHumanForm(test.db, who, change, signal)).toEqual(
    err(ERROR_IDS.WORKFLOW_CONFLICT),
  );
  expect(test.set).not.toHaveBeenCalled();
  expect(test.insert).not.toHaveBeenCalled();
});

it("keeps invalid answers and an expired or stale cursor from creating a receipt", async () => {
  const stale = database({ run: { ...waitingRun, nextNodeId: "next" } });
  const expired = database();
  const invalid = database();
  expired.returning.mockResolvedValueOnce([]);
  expect(await submitWorkflowHumanForm(stale.db, who, input, signal)).toEqual(
    err(ERROR_IDS.WORKFLOW_CONFLICT),
  );
  expect(stale.set).not.toHaveBeenCalled();
  expect(await submitWorkflowHumanForm(expired.db, who, input, signal)).toEqual(
    err(ERROR_IDS.WORKFLOW_CONFLICT),
  );
  expect(
    await submitWorkflowHumanForm(
      invalid.db,
      who,
      { ...input, answers: { hidden: "private" } },
      signal,
    ),
  ).toEqual(err(ERROR_IDS.WORKFLOW_INVALID));
  expect(invalid.set).not.toHaveBeenCalled();
  for (const test of [stale, expired, invalid]) expect(test.insert).not.toHaveBeenCalled();
});

it("denies missing or non-live runs before resolving the pinned form", async () => {
  for (const run of [null, { ...waitingRun, mode: "simulation" as const }]) {
    const test = database({ run });
    expect(await submitWorkflowHumanForm(test.db, who, input, signal)).toEqual(
      err(ERROR_IDS.WORKFLOW_DENIED),
    );
    expect(test.filters.has(workflowVersions)).toBe(false);
    expect(test.insert).not.toHaveBeenCalled();
  }
});

it("rolls back both writes when the session is revoked before commit", async () => {
  const test = database();
  access.sessionActor.mockResolvedValueOnce(actor).mockResolvedValueOnce(null);
  expect(await submitWorkflowHumanForm(test.db, who, input, signal)).toEqual(
    err(ERROR_IDS.WORKFLOW_DENIED),
  );
  expect(test.set).toHaveBeenCalledOnce();
  expect(test.insert).toHaveBeenCalledOnce();
  expect(test.rollback).toHaveBeenCalledOnce();
});

it("redacts driver errors that contain answer parameters", async () => {
  const test = database();
  test.insert.mockRejectedValueOnce(new Error("Parameter contained private form text"));
  expect(
    await submitWorkflowHumanForm(
      test.db,
      who,
      { ...input, answers: { [textId]: "private form text", [numberId]: 0 } },
      signal,
    ),
  ).toEqual(err(ERROR_IDS.WORKFLOW_WRITE_FAILED));
});
