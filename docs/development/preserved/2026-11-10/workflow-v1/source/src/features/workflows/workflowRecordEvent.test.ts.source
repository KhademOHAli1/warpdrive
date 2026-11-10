import { assert, expect, it, vi } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import type { PermissionFlagKey } from "@/constants/permissionFlags";
import type { PermSetUser } from "@/features/permissions/effective";
import { err, ok } from "@/types/result";
import {
  appendWorkflowRecordEvent,
  canExposeWorkflowRecordEvent,
  type WorkflowRecordEvent,
  type WorkflowRecordEventDealAccess,
  type WorkflowRecordEventDealImage,
  type WorkflowRecordEventTx,
  workflowRecordEventScope,
} from "./workflowRecordEvent";
import {
  readWorkflowRecordEventLaunch,
  type WorkflowRecordEventData,
  workflowRecordEventMatches,
  workflowRecordEventOutput,
  workflowRecordEventTriggerConfig,
} from "./workflowRecordEventContract";

const recordId = "0c8ca58d-74e3-4bd3-bdb9-1a2b1cadba59";
const ownerId = "bf395951-9fcf-471b-9afe-187140bd0fb5";
const pipelineId = "007df34a-41bb-414c-b124-47d396ea0fab";
const stageId = "2b761193-afc8-430f-b7bd-0423157c79f1";
const priorRevision = "66f9a036-0df4-4c7f-99e1-493b4c9f4c3f";
const eventId = "87ff00ce-7bb9-4813-8ab9-e93990b4b095";
const prior = {
  status: "open",
  pipelineId,
  stageId,
  value: "20.00",
  currency: "EUR",
  expectedCloseDate: null,
} as const;
const after = { ...prior, status: "won" } as const;
const occurredAt = new Date("2026-11-05T10:00:00.000Z");
const signal = new AbortController().signal;
const deal: WorkflowRecordEventDealAccess = {
  id: recordId,
  ownerId,
  pipelineId,
  visibilityGroupId: null,
  visibilityLevel: "owner",
  visibleToUserIds: [],
  writeVersion: eventId,
  deletedAt: null,
  pipelineArchived: false,
  pipelineVisibilityGroupId: null,
};
const scope = workflowRecordEventScope(deal);
const event: WorkflowRecordEvent = {
  eventId,
  sequence: 5n,
  recordId,
  kind: "updated",
  occurredAt,
  before: prior,
  after,
  beforeScope: scope,
  afterScope: scope,
  changedFields: ["status"],
};
const owner: PermSetUser = {
  id: ownerId,
  type: "regular",
  isActive: true,
  groupIds: new Set(),
  flags: new Set(),
};

it("matches the exact event, watched fields, and typed before/after filter before admission", () => {
  const trigger = workflowRecordEventTriggerConfig.parse({
    entity: "deal",
    event: "updated",
    match: {
      fields: ["status"],
      filter: {
        operator: "and",
        predicates: [
          { side: "before", field: "status", operator: "equals", value: "open" },
          { side: "after", field: "status", operator: "equals", value: "won" },
          { side: "after", field: "value", operator: "equals", value: "20" },
        ],
      },
    },
  });
  expect(workflowRecordEventMatches(trigger, event)).toBe(true);
  expect(workflowRecordEventMatches({ ...trigger, match: { fields: ["stageId"] } }, event)).toBe(
    false,
  );
  expect(workflowRecordEventMatches({ ...trigger, event: "upserted" }, event)).toBe(false);
  expect(workflowRecordEventMatches({ entity: "deal", event: "stageChanged" }, event)).toBe(false);
  expect(
    workflowRecordEventMatches(
      { entity: "deal", event: "stageChanged" },
      { ...event, changedFields: ["stageId"] },
    ),
  ).toBe(true);
  expect(
    workflowRecordEventTriggerConfig.safeParse({
      entity: "deal",
      event: "updated",
      match: {
        filter: {
          operator: "or",
          predicates: [{ side: "after", field: "title", operator: "exists" }],
        },
      },
    }).success,
  ).toBe(false);
});

it("keeps missing before/after distinct from a null field and never projects private metadata", () => {
  const deleted: WorkflowRecordEventData = {
    ...event,
    kind: "deleted",
    after: null,
    changedFields: [],
  };
  const trigger = workflowRecordEventTriggerConfig.parse({
    entity: "deal",
    event: "deleted",
    match: {
      filter: {
        operator: "and",
        predicates: [{ side: "after", field: "value", operator: "isEmpty" }],
      },
    },
  });
  expect(workflowRecordEventMatches(trigger, deleted)).toBe(false);
  expect(workflowRecordEventOutput(deleted)).toMatchObject({
    recordId,
    eventId,
    eventName: "deal.deleted",
    "before.status": "open",
    "before.expectedCloseDate": null,
  });
  expect(workflowRecordEventOutput(deleted)).not.toHaveProperty("after.status");
  expect(workflowRecordEventOutput(event)).not.toHaveProperty("beforeScope");
  const definition = {
    nodes: [
      {
        id: "start",
        type: "trigger.record",
        version: 1,
        config: { entity: "deal", event: "updated" },
      },
    ],
  };
  expect(
    readWorkflowRecordEventLaunch(definition, {
      kind: "record-event",
      eventId,
      recordId,
      event: "deleted",
    }),
  ).toBeNull();
});

it("denies a stale visibility scope and rechecks current pipeline permissions", () => {
  expect(canExposeWorkflowRecordEvent(owner, deal, event)).toBe(true);
  expect(canExposeWorkflowRecordEvent({ ...owner, isActive: false }, deal, event)).toBe(false);
  expect(
    canExposeWorkflowRecordEvent(
      owner,
      { ...deal, pipelineVisibilityGroupId: "restricted" },
      event,
    ),
  ).toBe(false);
  expect(canExposeWorkflowRecordEvent(owner, { ...deal, pipelineArchived: true }, event)).toBe(
    false,
  );
  expect(
    canExposeWorkflowRecordEvent({ ...owner, type: "admin" }, deal, {
      ...event,
      beforeScope: "other",
    }),
  ).toBe(false);
  expect(canExposeWorkflowRecordEvent(owner, { ...deal, deletedAt: occurredAt }, event)).toBe(
    false,
  );
});

it("requires a current exact soft-delete tombstone and native delete authority", () => {
  const tombstone = { ...deal, deletedAt: occurredAt };
  const deleted: WorkflowRecordEvent = {
    ...event,
    kind: "deleted",
    after: null,
    changedFields: [],
  };
  const canDelete = { ...owner, flags: new Set<PermissionFlagKey>(["deal.delete_own"]) };
  expect(canExposeWorkflowRecordEvent(owner, tombstone, deleted)).toBe(false);
  expect(canExposeWorkflowRecordEvent(canDelete, tombstone, deleted)).toBe(true);
  expect(
    canExposeWorkflowRecordEvent(canDelete, { ...tombstone, writeVersion: priorRevision }, deleted),
  ).toBe(false);
  expect(canExposeWorkflowRecordEvent(canDelete, deal, deleted)).toBe(false);
});

it("appends an allowlisted immutable image only under the exact Deal write lock", async () => {
  const lock = vi.fn(() => Promise.resolve([{ id: recordId }]));
  const values = vi.fn((_event: unknown) => ({
    onConflictDoNothing: () => ({ returning: () => Promise.resolve([{ eventId, sequence: 5n }]) }),
  }));
  const tx = {
    select: () => ({ from: () => ({ where: () => ({ for: lock }) }) }),
    insert: () => ({ values }),
  } as unknown as WorkflowRecordEventTx;
  const image: WorkflowRecordEventDealImage = { ...deal, ...prior, writeVersion: priorRevision };
  const next = { ...image, ...after, writeVersion: eventId, title: "private title" };
  expect(
    await appendWorkflowRecordEvent(tx, { kind: "updated", before: image, after: next }, signal),
  ).toEqual(ok({ eventId, sequence: 5n }));
  expect(lock).toHaveBeenCalledExactlyOnceWith("update");
  expect(lock.mock.invocationCallOrder[0]).toBeLessThan(values.mock.invocationCallOrder[0] ?? 0);
  const stored = values.mock.lastCall?.[0];
  assert(stored !== undefined);
  expect(stored).toMatchObject({ before: prior, after, changedFields: ["status"] });
  expect(JSON.stringify(stored)).not.toContain("private title");
  expect(
    await appendWorkflowRecordEvent(tx, { kind: "deleted", before: image, after: next }, signal),
  ).toEqual(err(ERROR_IDS.WORKFLOW_INVALID));
  expect(values).toHaveBeenCalledTimes(1);
});
