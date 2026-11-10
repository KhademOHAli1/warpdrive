import { TransactionRollbackError } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import type * as ContactActorAdapters from "@/features/contacts/actorAdapters";
import type { PermSetUser } from "@/features/permissions/effective";
import { err, ok } from "@/types/result";
import type { WorkflowDefinition, WorkflowNode } from "./schemas";
import { createWorkflowRecord, type RecordCreateMode } from "./workflowRecordCreate";
import { recordCreateConfig } from "./workflowRecordCreateContract";

const native = vi.hoisted(() => ({
  createActivity: vi.fn(),
  createDeal: vi.fn(),
  createLead: vi.fn(),
  createOrg: vi.fn(),
  createPerson: vi.fn(),
  loadContactActor: vi.fn(),
}));
vi.mock("@/features/activities/repo", () => ({ createActivity: native.createActivity }));
vi.mock("@/features/deals/dealActions", () => ({ createDeal: native.createDeal }));
vi.mock("@/features/leads/leadActions", () => ({ createLead: native.createLead }));
vi.mock("@/features/contacts/orgsRepo", () => ({ createOrg: native.createOrg }));
vi.mock("@/features/contacts/personsRepo", () => ({ createPerson: native.createPerson }));
vi.mock("@/features/contacts/actorAdapters", async (original) => ({
  ...(await original<typeof ContactActorAdapters>()),
  loadContactActor: native.loadContactActor,
}));

const pipelineId = "52f6b244-2ea8-400a-92c9-b584c938562f";
const stageId = "52f6b244-2ea8-400a-92c9-b584c9385630";
const actor: PermSetUser = {
  id: "actor",
  type: "regular",
  isActive: true,
  flags: new Set(["activity.create", "contact.create", "deal.create"]),
  groupIds: new Set(["group"]),
  managedUserIds: new Set(["managed-owner"]),
};
const literal = (value: string) => ({ kind: "value" as const, value });
const created = { id: "52f6b244-2ea8-400a-92c9-b584c9385631", visibilityLevel: "owner" };

beforeEach(() => {
  vi.resetAllMocks();
  native.loadContactActor.mockResolvedValue({ ...actor, primaryVisibilityGroupId: "group" });
  native.createActivity.mockResolvedValue(ok(created));
  native.createDeal.mockResolvedValue(ok(created));
  native.createLead.mockResolvedValue(ok(created));
  native.createOrg.mockResolvedValue(ok(created));
  native.createPerson.mockResolvedValue(ok(created));
});

function fixture(contained = false) {
  const rollback = vi.fn(() => {
    throw new TransactionRollbackError();
  });
  const select = vi.fn(() => ({
    from: () => ({
      where: () => Promise.resolve([{ id: "52f6b244-2ea8-400a-92c9-b584c9385632" }]),
    }),
  }));
  const tx = { rollback, select } as unknown as Db;
  const transaction = vi.fn((work: (tx: Db) => Promise<unknown>) => work(tx));
  const db = { transaction, ...(contained ? { rollback: vi.fn() } : {}) } as unknown as Db;
  return { db, tx, transaction, rollback, select };
}

function node(config: WorkflowNode["config"]): WorkflowNode {
  return { id: "create", name: "Create record", type: "record.create", version: 1, config };
}

function run(
  db: Db,
  action: WorkflowNode,
  mode: RecordCreateMode = "live",
  as = actor,
  definition: WorkflowDefinition = { schemaVersion: 1, nodes: [action], edges: [] },
  outputs = {},
) {
  return createWorkflowRecord(
    db,
    as,
    action,
    outputs,
    definition,
    mode,
    new AbortController().signal,
  );
}

describe("Create Record's typed configuration", () => {
  it("rejects service-owned inputs and fields from a different object", () => {
    for (const key of ["ownerId", "visibilityLevel", "stageId", "reminder"]) {
      expect(
        recordCreateConfig.safeParse({
          entity: "person",
          fields: { name: literal("Sam"), [key]: literal("injected") },
        }).success,
      ).toBe(false);
    }
  });

  it("checks literal types, destination IDs, and exact decimal precision", () => {
    const config = {
      entity: "deal",
      fields: {
        title: literal("Pipeline opportunity"),
        pipelineId: literal(pipelineId),
        stageId: literal(stageId),
        value: literal("99999999999999.9999"),
        expectedCloseDate: { kind: "value", value: "2030-03-01", literalType: "date" },
      },
    };
    expect(recordCreateConfig.safeParse(config).success).toBe(true);
    expect(
      recordCreateConfig.safeParse({
        ...config,
        fields: { ...config.fields, value: literal("99999999999999.99999") },
      }).success,
    ).toBe(false);
    expect(
      recordCreateConfig.safeParse({
        ...config,
        fields: {
          ...config.fields,
          pipelineId: { kind: "reference", nodeId: "start", path: ["recordId"] },
        },
      }).success,
    ).toBe(false);
  });
});

describe("Create Record's native service adapter", () => {
  it("rechecks the actual object capability before opening a transaction", async () => {
    const { db, transaction } = fixture();
    const result = await run(
      db,
      node({ entity: "organization", fields: { name: literal("Example org") } }),
      "live",
      { ...actor, flags: new Set(["deal.create"]) },
    );
    expect(result).toEqual(err(ERROR_IDS.PERM_DENIED));
    expect(transaction).not.toHaveBeenCalled();
    expect(native.createOrg).not.toHaveBeenCalled();
  });

  it("carries the scoped creator session and decimal string to the canonical Deal service", async () => {
    const { db, tx, rollback } = fixture();
    expect(
      await run(
        db,
        node({
          entity: "deal",
          fields: {
            title: literal("Pipeline opportunity"),
            pipelineId: literal(pipelineId),
            stageId: literal(stageId),
            value: literal("99999999999999.9999"),
          },
        }),
      ),
    ).toEqual(ok({ id: created.id }));
    expect(native.createDeal).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        userId: actor.id,
        flags: { "activity.create": true, "contact.create": true, "deal.create": true },
        primaryVisibilityGroupId: "group",
        visibilityGroupIds: ["group"],
        managedUserIds: ["managed-owner"],
      }),
      expect.objectContaining({ pipelineId, stageId, value: "99999999999999.9999" }),
      expect.any(AbortSignal),
    );
    expect(rollback).not.toHaveBeenCalled();
  });

  it("maps a created organization ID to the canonical person link and contact fields", async () => {
    const { db, tx } = fixture();
    const org: WorkflowNode = {
      ...node({ entity: "organization", fields: { name: literal("Acme") } }),
      id: "org",
    };
    const person = node({
      entity: "person",
      fields: {
        name: literal("Sam"),
        email: literal("sam@example.com"),
        orgId: { kind: "reference", nodeId: org.id, path: ["id"] },
      },
    });
    const start: WorkflowNode = {
      id: "start",
      name: "Manual trigger",
      type: "trigger.manual",
      version: 1,
      config: {},
    };
    const definition: WorkflowDefinition = {
      schemaVersion: 1,
      nodes: [start, org, person],
      edges: [
        { from: start.id, to: org.id, port: "next" },
        { from: org.id, to: person.id, port: "next" },
      ],
    };
    expect(await run(db, person, "live", actor, definition, { org: { id: created.id } })).toEqual(
      ok({ id: created.id }),
    );
    expect(native.createPerson).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        primaryVisibilityGroupId: "group",
        managedUserIds: actor.managedUserIds,
      }),
      expect.objectContaining({
        name: "Sam",
        orgId: created.id,
        emails: [{ value: "sam@example.com", primary: true, label: "" }],
      }),
      expect.any(AbortSignal),
    );
  });

  it("records workflow provenance and rolls back a failed typed result during a live run", async () => {
    const { db, tx, rollback } = fixture();
    native.createLead.mockResolvedValue(err(new AppError(ERROR_IDS.CF_VALUE_INVALID, "invalid")));
    expect(await run(db, node({ entity: "lead", fields: { title: literal("Lead") } }))).toEqual(
      err(ERROR_IDS.CF_VALUE_INVALID),
    );
    expect(native.createLead).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ userId: actor.id }),
      expect.objectContaining({ title: "Lead", sourceOrigin: "workflow" }),
      expect.any(AbortSignal),
    );
    expect(rollback).toHaveBeenCalledOnce();
  });

  it("uses the active task type with reminders disabled and rolls back the published preview", async () => {
    const { db, tx, rollback, select } = fixture();
    const result = await run(
      db,
      node({
        entity: "activity",
        fields: {
          subject: literal("Follow up"),
          dueAt: { kind: "value", value: "2030-03-01T10:00:00+01:00", literalType: "instant" },
        },
      }),
      "simulation",
    );
    expect(result).toEqual(ok({ id: created.id }));
    expect(select).toHaveBeenCalledOnce();
    expect(native.createActivity).toHaveBeenCalledWith(
      tx,
      actor,
      expect.objectContaining({ subject: "Follow up", dueAt: "2030-03-01T09:00:00.000Z" }),
      expect.any(AbortSignal),
      { scheduleReminder: false },
    );
    expect(rollback).toHaveBeenCalledOnce();
  });

  it("only retains a draft test record inside an enclosing transaction", async () => {
    const action = node({
      entity: "organization",
      fields: { name: literal("Acme"), city: literal("Berlin") },
    });
    const outside = fixture();
    expect(await run(outside.db, action, "draft-simulation")).toEqual(
      err(ERROR_IDS.WORKFLOW_WRITE_FAILED),
    );
    expect(outside.transaction).not.toHaveBeenCalled();
    const inside = fixture(true);
    expect(await run(inside.db, action, "draft-simulation")).toEqual(ok({ id: created.id }));
    expect(native.createOrg).toHaveBeenCalledWith(
      inside.tx,
      expect.objectContaining({ id: actor.id }),
      expect.objectContaining({ name: "Acme", address: { city: "Berlin" } }),
      expect.any(AbortSignal),
    );
    expect(inside.rollback).not.toHaveBeenCalled();
  });
});
