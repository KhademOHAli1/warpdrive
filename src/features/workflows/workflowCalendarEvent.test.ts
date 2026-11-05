import { TransactionRollbackError } from "drizzle-orm";
import { beforeEach, expect, it, vi } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import type { PermSetUser } from "@/features/permissions/effective";
import { err, ok } from "@/types/result";
import type { RunOutputs } from "./runTypes";
import type { WorkflowDefinition } from "./schemas";
import { createWorkflowCalendarEvent } from "./workflowCalendarEvent";
import {
  workflowCalendarEventConfig,
  workflowCalendarEventFieldTarget,
} from "./workflowCalendarEventContract";
import type { RecordCreateMode } from "./workflowRecordCreate";

const native = vi.hoisted(() => ({ createActivity: vi.fn(), resolveRunBinding: vi.fn() }));
vi.mock("@/features/activities/repo", () => ({ createActivity: native.createActivity }));
vi.mock("./runBindings", () => ({ resolveRunBinding: native.resolveRunBinding }));

const typeId = "abf7229b-c3be-4834-9cf9-2f7036b68b46";
const id = "81f1444b-8d8f-4ce1-a769-6c8bf3a030f3";
const actor: PermSetUser = {
  id: "52f6b244-2ea8-400a-92c9-b584c938562f",
  isActive: true,
  type: "regular",
  flags: new Set(["activity.create"]),
  groupIds: new Set(),
};
const text = (value: string) => ({ kind: "value" as const, value });
const instant = (value: string) => ({ ...text(value), literalType: "instant" as const });
const date = (value: string) => ({ ...text(value), literalType: "date" as const });
const timed = {
  title: text("Planning"),
  startsAt: instant("2026-11-09T09:15:00+01:00"),
  endsAt: instant("2026-11-09T10:00:00+01:00"),
  timeZone: "Europe/Berlin",
  allDay: false,
};
const definition: WorkflowDefinition = { schemaVersion: 1, nodes: [], edges: [] };
const signal = new AbortController().signal;

function fixture(types: Array<{ id: string }> = [{ id: typeId }]) {
  const rollback = vi.fn(() => {
    throw new TransactionRollbackError();
  });
  const lock = vi.fn(async () => types);
  const select = vi.fn(() => ({ from: () => ({ where: () => ({ for: lock }) }) }));
  const savepoint = { rollback, select } as unknown as Db;
  const transaction = vi.fn(async (work: (tx: Db) => Promise<unknown>) => work(savepoint));
  return {
    db: { rollback: vi.fn(), transaction } as unknown as Db,
    savepoint,
    rollback,
    lock,
    select,
  };
}

function run(
  db: Db,
  config: unknown = timed,
  mode: RecordCreateMode = "live",
  authority = actor,
  outputs: RunOutputs = {},
) {
  return createWorkflowCalendarEvent(
    db,
    authority,
    { id: "event", version: 1, config },
    outputs,
    definition,
    mode,
    signal,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  native.createActivity.mockResolvedValue(ok({ id }));
});

it("rejects provider options, invalid zones, and a wrong temporal type", () => {
  expect(workflowCalendarEventConfig.safeParse(timed).success).toBe(true);
  for (const patch of [
    { connectedAccountId: id },
    { sendInvitations: false },
    { timeZone: "+01:00" },
    { timeZone: "Unknown/Zone" },
    { startsAt: date("2026-11-09") },
    { endsAt: timed.startsAt },
  ]) {
    expect(workflowCalendarEventConfig.safeParse({ ...timed, ...patch }).success).toBe(false);
  }
  expect(workflowCalendarEventFieldTarget("event", "startsAt", true)?.contract.kind).toBe("date");
  expect(workflowCalendarEventFieldTarget("event", "startsAt", false)?.contract.kind).toBe(
    "instant",
  );
});

it("creates a timed CRM meeting with exact instants and no reminder scheduling", async () => {
  const { db, savepoint, rollback, lock } = fixture();
  const config = { ...timed, description: text("A < B\nSecond line"), location: text(" Office ") };
  expect(await run(db, config)).toEqual(ok({ id }));
  expect(lock).toHaveBeenCalledWith("share");
  expect(native.createActivity).toHaveBeenCalledWith(
    savepoint,
    actor,
    expect.objectContaining({
      typeId,
      subject: "Planning",
      allDay: false,
      authoredTimeZone: "Europe/Berlin",
      dueAt: "2026-11-09T08:15:00.000Z",
      endAt: "2026-11-09T09:00:00.000Z",
      durationMinutes: 45,
      dueDate: null,
      endDate: null,
      guestPersonIds: [],
      participantUserIds: [],
      location: "Office",
      note: "<p>A &lt; B<br>Second line</p>",
      videoCallUrl: null,
    }),
    signal,
    { scheduleReminder: false },
  );
  expect(rollback).not.toHaveBeenCalled();
});

it("preserves an inclusive multi-day civil range across the Berlin spring clock change", async () => {
  const { db } = fixture();
  const config = {
    ...timed,
    allDay: true,
    startsAt: date("2026-03-29"),
    endsAt: date("2026-03-30"),
  };
  expect(await run(db, config)).toEqual(ok({ id }));
  expect(native.createActivity.mock.calls[0]?.[2]).toMatchObject({
    allDay: true,
    dueDate: "2026-03-29",
    endDate: "2026-03-30",
    dueAt: "2026-03-28T23:00:00.000Z",
    endAt: "2026-03-29T22:00:00.000Z",
    durationMinutes: null,
  });
  expect(
    workflowCalendarEventConfig.safeParse({ ...config, endsAt: config.startsAt }).success,
  ).toBe(true);
  expect(
    workflowCalendarEventConfig.safeParse({
      ...config,
      startsAt: config.endsAt,
      endsAt: config.startsAt,
    }).success,
  ).toBe(false);
  expect(
    workflowCalendarEventConfig.safeParse({
      ...config,
      timeZone: "Pacific/Apia",
      startsAt: date("2011-12-30"),
      endsAt: date("2011-12-31"),
    }).success,
  ).toBe(false);
});

it("validates a mapped schedule at run time in the pinned workflow context", async () => {
  const { db } = fixture();
  const endsAt = { kind: "reference", nodeId: "earlier", path: ["resumeAt"] };
  const outputs = { earlier: { resumeAt: "2026-11-09T07:00:00Z" } };
  native.resolveRunBinding.mockReturnValueOnce({ state: "value", value: outputs.earlier.resumeAt });
  expect(await run(db, { ...timed, endsAt }, "live", actor, outputs)).toEqual(
    err(ERROR_IDS.WORKFLOW_INVALID),
  );
  expect(native.resolveRunBinding).toHaveBeenCalledWith(endsAt, outputs, {
    definition,
    nodeId: "event",
    path: ["endsAt"],
  });
  native.resolveRunBinding.mockReturnValueOnce({ state: "missing", reason: "property-absent" });
  expect(await run(db, { ...timed, endsAt })).toEqual(err(ERROR_IDS.WORKFLOW_BINDING_MISSING));
  expect(native.createActivity).not.toHaveBeenCalled();
});

it("requires activity creation permission and an active Meeting type", async () => {
  const { db, select } = fixture([]);
  expect(await run(db, timed, "live", { ...actor, flags: new Set() })).toEqual(
    err(ERROR_IDS.PERM_DENIED),
  );
  expect(select).not.toHaveBeenCalled();
  expect(await run(db)).toEqual(err(ERROR_IDS.WORKFLOW_NOT_READY));
  expect(native.createActivity).not.toHaveBeenCalled();
});

it.each(["simulation", "draft-simulation"] as const)(
  "rolls back local calendar metadata and event writes for %s",
  async (mode) => {
    const { db, savepoint, rollback } = fixture();
    expect(await run(db, timed, mode)).toEqual(ok({ id }));
    expect(native.createActivity).toHaveBeenCalledWith(
      savepoint,
      actor,
      expect.any(Object),
      signal,
      { scheduleReminder: false },
    );
    expect(rollback).toHaveBeenCalledOnce();
  },
);
