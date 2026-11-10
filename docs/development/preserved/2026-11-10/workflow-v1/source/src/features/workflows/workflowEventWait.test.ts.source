import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, expect, it, vi } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import { workflowRuns } from "@/db/schema/workflowExecutions";
import { workflowRecordEvents, workflowRecordEventWaits } from "@/db/schema/workflowRecordEvents";
import type { PermSetUser } from "@/features/permissions/effective";
import { err, ok } from "@/types/result";
import { resolveRunBinding } from "./runBindings";
import { advanceWorkflowEventWait, type WorkflowEventWaitContext } from "./workflowEventWait";
import {
  workflowEventWaitConfig,
  workflowEventWaitDeadline,
  workflowEventWaitMaxMinutes,
} from "./workflowEventWaitContract";
import {
  lockWorkflowRecordEventDeal,
  readVisibleWorkflowRecordEvent,
  type WorkflowRecordEvent,
  type WorkflowRecordEventDealAccess,
  type WorkflowRecordEventTx,
  workflowRecordEventScope,
} from "./workflowRecordEvent";

vi.mock("./runBindings", () => ({ resolveRunBinding: vi.fn() }));
vi.mock("./workflowRecordEvent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./workflowRecordEvent")>()),
  lockWorkflowRecordEventDeal: vi.fn(),
  readVisibleWorkflowRecordEvent: vi.fn(),
}));

const recordId = "dcce211d-8029-44f7-bd78-1324e03c6d78";
const runId = "76729e5c-14a2-421d-947e-dda1fc696845";
const workflowId = "e90107bc-e60a-4c43-803e-95ace1c53dfa";
const actorId = "0a297ba6-e621-460b-a3e0-24b276ec22ad";
const eventId = "e4f4e0de-e8ac-4a90-ac9e-6b899bca24a3";
const pipelineId = "36ab5df4-8339-451f-a32a-dd5f5a98ac8e";
const stageId = "3e40947b-0b41-4c47-84c2-aa60b80af664";
const armedAt = new Date("2026-11-05T10:00:00.000Z");
const deadline = new Date("2026-11-05T10:01:00.000Z");
const signal = new AbortController().signal;
const actor: PermSetUser = {
  id: actorId,
  type: "admin",
  isActive: true,
  groupIds: new Set(),
  flags: new Set(),
};
const deal: WorkflowRecordEventDealAccess = {
  id: recordId,
  ownerId: actorId,
  pipelineId,
  visibilityLevel: "owner",
  visibilityGroupId: null,
  visibleToUserIds: [],
  writeVersion: eventId,
  deletedAt: null,
  pipelineArchived: false,
  pipelineVisibilityGroupId: null,
};
const scope = workflowRecordEventScope(deal);
const before = {
  status: "open",
  pipelineId,
  stageId,
  value: null,
  currency: "EUR",
  expectedCloseDate: null,
} as const;
const candidate: WorkflowRecordEvent = {
  eventId,
  recordId,
  sequence: 9n,
  kind: "updated",
  occurredAt: new Date("2026-11-05T10:00:30.000Z"),
  before,
  after: { ...before, status: "won" },
  beforeScope: scope,
  afterScope: scope,
  changedFields: ["status"],
};
const config = {
  entity: "deal",
  event: "updated",
  recordId: { kind: "value", value: recordId },
  updatedFields: ["status"],
  timeoutMinutes: 1,
};
type Wait = typeof workflowRecordEventWaits.$inferSelect;
const waiting: Wait = {
  id: "535c52d7-9f75-4f02-8169-602ca936904b",
  runId,
  nodeId: "wait",
  iterationIndex: -1,
  recordId,
  kind: "updated",
  watchedFields: ["status"],
  afterSequence: 8n,
  armedAt,
  deadline,
  state: "waiting",
  matchedEventId: null,
  finishedAt: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(lockWorkflowRecordEventDeal).mockResolvedValue(deal);
  vi.mocked(readVisibleWorkflowRecordEvent).mockResolvedValue(candidate);
});

function fixture({
  existing,
  event,
  now = armedAt,
}: {
  existing?: Wait;
  event?: WorkflowRecordEvent;
  now?: Date;
} = {}) {
  let row = existing;
  const dialect = new PgDialect();
  const eventQueries: string[] = [];
  const insert = vi.fn((input: unknown) => input);
  const updateRun = vi.fn((input: unknown) => input);
  const settle = vi.fn((patch: Partial<Wait>) => {
    if (row !== undefined) row = { ...row, ...patch };
  });
  const tx = {
    select: (projection?: unknown) => ({
      from: (table: unknown) => ({
        where: (query: SQL) => {
          if (table === workflowRecordEventWaits)
            return Promise.resolve(row === undefined ? [] : [row]);
          expect(table).toBe(workflowRecordEvents);
          eventQueries.push(dialect.sqlToQuery(query).sql);
          return {
            orderBy: () => ({
              limit: () =>
                Promise.resolve(
                  projection === undefined
                    ? event === undefined
                      ? []
                      : [event]
                    : [{ sequence: 8n }],
                ),
            }),
          };
        },
      }),
    }),
    execute: () => Promise.resolve({ rows: [{ milliseconds: now.getTime() }] }),
    insert: () => ({
      values: (data: unknown) => {
        insert(data);
        return {
          onConflictDoNothing: () => ({ returning: () => Promise.resolve([{ id: waiting.id }]) }),
        };
      },
    }),
    update: (table: unknown) => ({
      set: (patch: Partial<Wait>) => ({
        where: () => {
          if (table === workflowRuns) {
            updateRun(patch);
            return Promise.resolve([]);
          }
          settle(patch);
          return { returning: () => Promise.resolve([{ id: waiting.id }]) };
        },
      }),
    }),
  } as unknown as WorkflowRecordEventTx;
  const context: WorkflowEventWaitContext = {
    tx,
    actor,
    workflowOwnerId: actorId,
    node: { id: "wait", type: "event.wait", version: 1, config },
    definition: { schemaVersion: 1, nodes: [], edges: [] },
    run: {
      id: runId,
      workflowId,
      actorId,
      mode: "live",
      status: existing === undefined ? "running" : "waiting",
      versionId: "7fb3a33e-4336-43fa-b92d-037af344a020",
      requestKey: "c0d0a304-fc03-45be-b87a-73311407b0ae",
      trigger: { scope: "global" },
      nextNodeId: "wait",
      iteratorFrame: null,
      resumeAt: existing?.deadline ?? null,
      outputs: {},
      errorId: null,
      cancelledBy: null,
      cancelledAt: null,
      createdAt: armedAt,
      updatedAt: armedAt,
    },
  };
  return { context, insert, updateRun, settle, eventQueries };
}

it("requires a concrete record and finite bounded timeout, with no widened wait", async () => {
  expect(workflowEventWaitConfig.safeParse({ ...config, recordId: undefined }).success).toBe(false);
  expect(workflowEventWaitConfig.safeParse({ ...config, timeoutMinutes: 0 }).success).toBe(false);
  expect(
    workflowEventWaitConfig.safeParse({
      ...config,
      timeoutMinutes: workflowEventWaitMaxMinutes + 1,
    }).success,
  ).toBe(false);
  expect(workflowEventWaitConfig.safeParse({ ...config, event: "created" }).success).toBe(false);
  expect(workflowEventWaitDeadline(new Date(Number.NaN), 1)).toBeNull();
  const { context, insert } = fixture();
  context.node.config = {
    ...config,
    recordId: { kind: "reference", nodeId: "read", path: ["id"] },
  };
  vi.mocked(resolveRunBinding).mockReturnValue({ state: "missing", reason: "property-absent" });
  expect(await advanceWorkflowEventWait(context, signal)).toEqual(
    err(ERROR_IDS.WORKFLOW_BINDING_MISSING),
  );
  expect(lockWorkflowRecordEventDeal).not.toHaveBeenCalled();
  expect(insert).not.toHaveBeenCalled();
});

it("arms under the Deal lock and writes the subscription cursor and run deadline together", async () => {
  const { context, insert, updateRun } = fixture();
  expect(await advanceWorkflowEventWait(context, signal)).toEqual(
    ok({ status: "waiting", armedDeadline: deadline }),
  );
  expect(lockWorkflowRecordEventDeal).toHaveBeenCalledExactlyOnceWith(context.tx, recordId, signal);
  expect(insert).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      recordId,
      afterSequence: 8n,
      armedAt,
      deadline,
      watchedFields: ["status"],
    }),
  );
  expect(updateRun).toHaveBeenCalledExactlyOnceWith({
    status: "waiting",
    resumeAt: deadline,
    updatedAt: armedAt,
  });
});

it("uses the first matching pre-deadline event once, including at a delayed wake", async () => {
  const { context, settle, eventQueries } = fixture({
    existing: waiting,
    event: candidate,
    now: deadline,
  });
  const result = await advanceWorkflowEventWait(context, signal);
  expect(result).toMatchObject({
    ok: true,
    value: {
      status: "completed",
      output: { hasTimedOut: false, eventId, "before.status": "open", "after.status": "won" },
    },
  });
  expect(eventQueries[0]).toContain('"sequence" >');
  expect(eventQueries[0]).toContain('"occurred_at" <=');
  expect(eventQueries[0]).toContain('"changed_fields" &&');
  expect(await advanceWorkflowEventWait(context, signal)).toEqual(result);
  expect(settle).toHaveBeenCalledExactlyOnceWith({
    state: "event",
    matchedEventId: eventId,
    finishedAt: deadline,
  });
});

it("times out once and leaves no record details in the timeout DTO", async () => {
  const late = { ...candidate, occurredAt: new Date(deadline.getTime() + 1) };
  const { context, settle } = fixture({ existing: waiting, event: late, now: deadline });
  const expected = ok({ status: "completed", output: { hasTimedOut: true } });
  expect(await advanceWorkflowEventWait(context, signal)).toEqual(expected);
  expect(await advanceWorkflowEventWait(context, signal)).toEqual(expected);
  expect(settle).toHaveBeenCalledExactlyOnceWith({
    state: "timed_out",
    matchedEventId: null,
    finishedAt: deadline,
  });
  expect(readVisibleWorkflowRecordEvent).not.toHaveBeenCalled();
});

it("keeps waiting for unrelated or invisible events and rejects cancelled runs", async () => {
  const { context, settle } = fixture({
    existing: waiting,
    event: { ...candidate, afterScope: "stale" },
    now: armedAt,
  });
  expect(await advanceWorkflowEventWait(context, signal)).toEqual(ok({ status: "waiting" }));
  expect(settle).not.toHaveBeenCalled();
  context.run.status = "cancelled";
  expect(await advanceWorkflowEventWait(context, signal)).toEqual(err(ERROR_IDS.WORKFLOW_DENIED));
  expect(lockWorkflowRecordEventDeal).toHaveBeenCalledTimes(1);
});
