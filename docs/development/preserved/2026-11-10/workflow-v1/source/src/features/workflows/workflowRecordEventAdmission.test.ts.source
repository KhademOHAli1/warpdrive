import { beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { workflowRuns } from "@/db/schema/workflowExecutions";
import { workflows, workflowVersions } from "@/db/schema/workflows";
import { hydrateActor } from "@/server/hydrateActor";
import { err, ok } from "@/types/result";
import {
  readVisibleWorkflowRecordEvent,
  type WorkflowRecordEvent,
  type WorkflowRecordEventTx,
} from "./workflowRecordEvent";
import {
  admitWorkflowRecordEvent,
  type InsertRecordEventRun,
  workflowRecordEventRequestKey,
} from "./workflowRecordEventAdmission";

vi.mock("@/server/hydrateActor", () => ({ hydrateActor: vi.fn() }));
vi.mock("./definition", () => ({ validateDefinition: () => ({ ok: true }) }));
vi.mock("./readiness", () => ({
  executableDefinition: () => true,
  requiresExternalHttp: () => false,
  requiresHumanForm: () => false,
}));
vi.mock("./workflowRecordEvent", () => ({ readVisibleWorkflowRecordEvent: vi.fn() }));

const input = {
  workflowId: "98075f28-f1e3-455c-af03-f602bdc79941",
  versionId: "18b2cf40-5e5e-4480-8943-ebd728527db0",
  eventId: "55499744-d3fb-4c14-92c2-d025e6898907",
};
const ownerId = "16e99ced-aec7-482b-bd71-9700d6af4486";
const recordId = "39eeb04d-44f4-4eb2-bb4e-9171ef1475e2";
const runId = "feab96a3-9745-4a72-bba8-e44f73d0809f";
const createdAt = new Date("2026-11-05T10:00:00.000Z");
const signal = new AbortController().signal;
const owner = {
  id: ownerId,
  type: "admin" as const,
  isActive: true,
  flags: new Set<never>(),
  groupIds: new Set<string>(),
  name: "Synthetic owner",
  email: "owner@example.test",
  avatarUrl: null,
};
const snapshot = {
  status: "open" as const,
  pipelineId: "816d72b8-68ea-4810-b564-3b38bff4a5f7",
  stageId: "2a92894c-1593-46ad-8c6f-08240142f275",
  value: null,
  currency: "EUR",
  expectedCloseDate: null,
};
const event: WorkflowRecordEvent = {
  eventId: input.eventId,
  recordId,
  kind: "updated",
  sequence: 3n,
  occurredAt: new Date(createdAt.getTime() + 1),
  before: snapshot,
  after: { ...snapshot, status: "won" },
  beforeScope: "a".repeat(64),
  afterScope: "a".repeat(64),
  changedFields: ["status"],
};
const definition = {
  schemaVersion: 1,
  nodes: [
    {
      id: "start",
      type: "trigger.record",
      name: "Record changed",
      version: 1,
      config: { entity: "deal", event: "updated", match: { fields: ["status"] } },
    },
  ],
  edges: [],
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(hydrateActor).mockResolvedValue(owner);
  vi.mocked(readVisibleWorkflowRecordEvent).mockResolvedValue(event);
});

function fixture() {
  const rows: { id: string }[] = [];
  const lock = vi.fn(() => Promise.resolve([{ ownerId, publishedNumber: 2 }]));
  const tx = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => {
          if (table === workflows) return { for: lock };
          if (table === workflowVersions) return Promise.resolve([{ definition, createdAt }]);
          expect(table).toBe(workflowRuns);
          return { limit: () => Promise.resolve(rows) };
        },
      }),
    }),
  } as unknown as WorkflowRecordEventTx;
  const db = {
    transaction: (callback: (tx: WorkflowRecordEventTx) => unknown) => callback(tx),
  } as unknown as Db;
  const insert = vi.fn<InsertRecordEventRun>((_tx, request) => {
    rows.push({ ...request, id: runId });
    return Promise.resolve({ id: runId });
  });
  return { db, tx, lock, insert };
}

it("uses the currently authorized owner and one immutable workflow-event admission key", async () => {
  const { db, tx, lock, insert } = fixture();
  const key = workflowRecordEventRequestKey(input);
  expect(z.uuid({ version: "v8" }).safeParse(key).success).toBe(true);
  expect(workflowRecordEventRequestKey({ ...input, eventId: recordId })).not.toBe(key);
  expect(await admitWorkflowRecordEvent(db, input, insert, signal)).toEqual(ok(runId));
  expect(await admitWorkflowRecordEvent(db, input, insert, signal)).toEqual(ok(runId));
  expect(lock).toHaveBeenCalledWith("update");
  expect(readVisibleWorkflowRecordEvent).toHaveBeenCalledWith(tx, owner, input.eventId, signal);
  expect(insert).toHaveBeenCalledExactlyOnceWith(tx, {
    workflowId: input.workflowId,
    versionId: input.versionId,
    actorId: ownerId,
    requestKey: key,
    mode: "live",
    nextNodeId: "start",
    trigger: { kind: "record-event", eventId: input.eventId, recordId, event: "updated" },
  });
});

it("skips invisible, unrelated or prepublication events and rejects a revoked owner", async () => {
  const { db, insert } = fixture();
  for (const ignored of [
    null,
    { ...event, changedFields: [] },
    { ...event, occurredAt: new Date(createdAt.getTime() - 1) },
  ]) {
    vi.mocked(readVisibleWorkflowRecordEvent).mockResolvedValueOnce(ignored);
    expect(await admitWorkflowRecordEvent(db, input, insert, signal)).toEqual(ok(null));
  }
  vi.mocked(hydrateActor).mockResolvedValueOnce(null);
  expect(await admitWorkflowRecordEvent(db, input, insert, signal)).toEqual(
    err(ERROR_IDS.WORKFLOW_DENIED),
  );
  expect(insert).not.toHaveBeenCalled();
  expect(readVisibleWorkflowRecordEvent).toHaveBeenCalledTimes(3);
});
