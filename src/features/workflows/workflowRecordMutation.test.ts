import { type SQL, TransactionRollbackError } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { assert, beforeEach, expect, it, vi } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import type * as PersonsRepo from "@/features/contacts/personsRepo";
import type * as DealAuth from "@/features/deals/dealAuth";
import type { PermSetUser } from "@/features/permissions/effective";
import { err, ok } from "@/types/result";
import type { WorkflowNode } from "./schemas";
import { mutateWorkflowRecord } from "./workflowRecordMutation";
import { recordUpdateConfig } from "./workflowRecordMutationContract";

const native = vi.hoisted(() => ({
  updateDeal: vi.fn(),
  deleteDeal: vi.fn(),
  loadEditableDeal: vi.fn(),
  lockStageDeal: vi.fn(),
  updatePerson: vi.fn(),
  bulkUpdateLeads: vi.fn(),
  deleteActivity: vi.fn(),
  hydrateActor: vi.fn(),
}));
vi.mock("@/features/deals/dealUpdate", () => ({ updateDeal: native.updateDeal }));
vi.mock("@/features/deal-workspace/deleteDeal", () => ({ deleteDeal: native.deleteDeal }));
vi.mock("@/features/deals/dealAuth", async (original) => ({
  ...(await original<typeof DealAuth>()),
  loadEditableDeal: native.loadEditableDeal,
}));
vi.mock("@/features/deals/nativeStageAccess", () => ({ lockStageDeal: native.lockStageDeal }));
vi.mock("@/features/contacts/personsRepo", async (original) => ({
  ...(await original<typeof PersonsRepo>()),
  updatePerson: native.updatePerson,
}));
vi.mock("@/features/leads/leadBulk", () => ({ bulkUpdateLeads: native.bulkUpdateLeads }));
vi.mock("@/features/activities/activityDelete", () => ({ deleteActivity: native.deleteActivity }));
vi.mock("@/server/hydrateActor", () => ({ hydrateActor: native.hydrateActor }));

const recordId = "52f6b244-2ea8-400a-92c9-b584c938562f";
const pipelineId = "52f6b244-2ea8-400a-92c9-b584c9385630";
const updatedAt = new Date("2031-01-01T10:00:00.123Z");
const actor: PermSetUser = {
  id: "52f6b244-2ea8-400a-92c9-b584c9385631",
  type: "regular",
  isActive: true,
  flags: new Set(["contact.edit_own", "deal.edit_own", "deal.delete_own", "bulk.edit"]),
  groupIds: new Set(),
};
const current = { ...actor, managedUserIds: new Set(["managed-owner"]) };
const literal = (value: string | null) => ({ kind: "value" as const, value });

beforeEach(() => {
  vi.resetAllMocks();
  native.hydrateActor.mockResolvedValue(current);
  native.loadEditableDeal.mockResolvedValue(ok({ deal: { pipelineId } }));
  native.lockStageDeal.mockResolvedValue({
    pipeline: { id: pipelineId, isArchived: false },
    deal: { id: recordId, pipelineId, updatedAt, deletedAt: null },
  });
  for (const action of [
    native.updateDeal,
    native.deleteDeal,
    native.updatePerson,
    native.deleteActivity,
  ])
    action.mockResolvedValue(ok({ id: recordId }));
  native.bulkUpdateLeads.mockResolvedValue(ok({ updated: 1, skipped: 0 }));
});

function database(rows: unknown[] = [{ id: recordId, updatedAt }], contained = false) {
  const rollback = vi.fn(() => {
    throw new TransactionRollbackError();
  });
  const lock = vi.fn(() => Promise.resolve(rows));
  const where = vi.fn<(conditions: SQL) => { for: typeof lock }>(() => ({ for: lock }));
  const query = { from: () => query, innerJoin: () => query, where };
  const tx = { rollback, select: () => query } as unknown as Db;
  const transaction = vi.fn((work: (tx: Db) => Promise<unknown>) => work(tx));
  const db = { transaction, ...(contained ? { rollback: vi.fn() } : {}) } as unknown as Db;
  return { db, tx, transaction, rollback, lock, where };
}

function run(
  db: Db,
  type: "record.update" | "record.delete",
  config: WorkflowNode["config"],
  mode: "live" | "simulation" | "draft-simulation" = "live",
) {
  const node: WorkflowNode = {
    id: "change",
    type,
    version: 1,
    name: "Change record",
    config: { recordId: literal(recordId), ...config },
  };
  return mutateWorkflowRecord(
    db,
    actor,
    node,
    {},
    { schemaVersion: 1, nodes: [node], edges: [] },
    mode,
    new AbortController().signal,
  );
}

it("requires an explicit nonempty patch and excludes authority fields and unsafely replaced collections", () => {
  for (const fields of [{}, { ownerId: literal(recordId) }, { email: literal("a@example.com") }]) {
    expect(
      recordUpdateConfig.safeParse({ entity: "person", recordId: literal(recordId), fields })
        .success,
    ).toBe(false);
  }
  expect(
    recordUpdateConfig.safeParse({
      entity: "deal",
      recordId: literal(recordId),
      fields: { currency: literal("USD") },
    }).success,
  ).toBe(false);
});

it("uses the locked Deal CAS token and preserves a deliberate clear without patching omitted fields", async () => {
  const { db, tx, rollback } = database();
  expect(
    await run(db, "record.update", { entity: "deal", fields: { value: literal(null) } }),
  ).toEqual(ok({ id: recordId }));
  expect(native.lockStageDeal).toHaveBeenCalledWith(tx, recordId, pipelineId, true);
  expect(native.updateDeal).toHaveBeenCalledWith(
    tx,
    current,
    { dealId: recordId, expectedUpdatedAt: updatedAt.toISOString(), value: null },
    expect.any(AbortSignal),
  );
  expect(rollback).not.toHaveBeenCalled();
});

it("soft-deletes through the canonical Deal CAS service and rolls a published simulation back", async () => {
  const { db, tx, rollback } = database();
  expect(await run(db, "record.delete", { entity: "deal" }, "simulation")).toEqual(
    ok({ deleted: true }),
  );
  expect(native.deleteDeal).toHaveBeenCalledWith(
    tx,
    current,
    { dealId: recordId, expectedUpdatedAt: updatedAt.toISOString() },
    expect.any(AbortSignal),
  );
  expect(rollback).toHaveBeenCalledOnce();
});

it("holds the visible contact row before refreshing authority and calling the native edit", async () => {
  const { db, tx, lock } = database();
  const result = await run(db, "record.update", {
    entity: "person",
    fields: { firstName: literal("Sam") },
  });
  expect(result).toEqual(ok({ id: recordId }));
  expect(lock).toHaveBeenCalledWith("update");
  const lockedAt = lock.mock.invocationCallOrder[0];
  const hydratedAt = native.hydrateActor.mock.invocationCallOrder[0];
  assert(lockedAt !== undefined && hydratedAt !== undefined);
  expect(lockedAt).toBeLessThan(hydratedAt);
  expect(native.updatePerson).toHaveBeenCalledWith(
    tx,
    expect.objectContaining({ managedUserIds: current.managedUserIds }),
    { id: recordId, firstName: "Sam" },
    expect.any(AbortSignal),
  );
});

it("does not write a contact when the current actor was revoked during the lock", async () => {
  const { db, rollback } = database();
  native.hydrateActor.mockResolvedValue(null);
  expect(
    await run(db, "record.update", { entity: "person", fields: { name: literal("Sam") } }),
  ).toEqual(err(ERROR_IDS.PERM_DENIED));
  expect(native.updatePerson).not.toHaveBeenCalled();
  expect(rollback).toHaveBeenCalledOnce();
});

it("treats a skipped native Lead soft deletion as unavailable and retains its permission session", async () => {
  const { db, tx, rollback } = database();
  native.bulkUpdateLeads.mockResolvedValue(ok({ updated: 0, skipped: 1 }));
  expect(await run(db, "record.delete", { entity: "lead" })).toEqual(err(ERROR_IDS.LEAD_NOT_FOUND));
  expect(native.bulkUpdateLeads).toHaveBeenCalledWith(
    tx,
    expect.objectContaining({
      flags: expect.objectContaining({
        "bulk.edit": true,
        "deal.edit_own": true,
        "deal.delete_own": true,
      }),
    }),
    { ids: [recordId], change: { deleted: true } },
    expect.any(AbortSignal),
  );
  expect(rollback).toHaveBeenCalledOnce();
});

it("allows only visible active Tasks and retains test effects only in a contained draft", async () => {
  const outside = database();
  expect(
    await run(outside.db, "record.delete", { entity: "activity" }, "draft-simulation"),
  ).toEqual(err(ERROR_IDS.WORKFLOW_WRITE_FAILED));
  expect(outside.transaction).not.toHaveBeenCalled();

  const inside = database([{ id: recordId }], true);
  expect(await run(inside.db, "record.delete", { entity: "activity" }, "draft-simulation")).toEqual(
    ok({ deleted: true }),
  );
  const predicate = inside.where.mock.calls[0]?.[0];
  expect(predicate).toBeDefined();
  if (predicate === undefined) throw new Error("Expected a task predicate");
  const compiled = new PgDialect().sqlToQuery(predicate);
  expect(compiled.params).toContain("task");
  expect(compiled.sql).toContain("activity_participants");
  expect(native.deleteActivity).toHaveBeenCalledWith(
    inside.tx,
    current,
    recordId,
    expect.any(AbortSignal),
  );
  expect(inside.rollback).not.toHaveBeenCalled();
});
