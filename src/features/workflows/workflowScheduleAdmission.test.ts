import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { assert, beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { workflowRuns, workflows, workflowVersions } from "@/db/schema";
import type { HydratedActor } from "@/server/hydrateActor";
import { err, ok } from "@/types/result";
import type * as WorkflowSchemas from "./schemas";
import {
  admitScheduledWorkflowOccurrence,
  type InsertScheduledWorkflowRun,
  workflowScheduleRequestKey,
} from "./workflowScheduleAdmission";
import { readDueScheduledWorkflowPage } from "./workflowSchedulePoll";

const shared = vi.hoisted(() => ({
  hydrate: vi.fn(),
  parse: vi.fn(),
  executable: vi.fn(),
  validate: vi.fn(),
}));
vi.mock("@/server/hydrateActor", () => ({ hydrateActor: shared.hydrate }));
vi.mock("./schemas", async (original) => ({
  ...(await original<typeof WorkflowSchemas>()),
  definitionSchema: { safeParse: shared.parse },
}));
vi.mock("./readiness", () => ({ executableDefinition: shared.executable }));
vi.mock("./definition", () => ({ validateDefinition: shared.validate }));

const workflowId = "15629694-761f-4f60-8f29-45f6a419408f";
const versionId = "59fe39a1-d916-40a9-abf9-c22717a0c407";
const runId = "825c8586-de36-46f1-b008-c33284a12c27";
const ownerId = "d1bdc0e0-d0ce-4bf7-89f6-8cdd71c79a53";
const scheduledAt = "2026-11-02T09:05:00.000Z";
const nowMs = Date.parse("2026-11-02T09:05:29.123Z");
const publishedAt = new Date("2026-11-02T09:00:04.000Z");
const occurrence = { workflowId, versionId, scheduledAt };
const definition = {
  schemaVersion: 1,
  nodes: [
    {
      id: "start",
      name: "Schedule",
      type: "trigger.schedule",
      version: 1,
      config: { interval: "minutes", minutes: 5 },
    },
  ],
  edges: [],
};
const owner: HydratedActor = {
  id: ownerId,
  name: "Schedule owner",
  email: "schedule-owner@example.invalid",
  avatarUrl: null,
  type: "regular",
  isActive: true,
  flags: new Set(["workflow.run"]),
  groupIds: new Set(),
};
const signal = new AbortController().signal;

beforeEach(() => {
  vi.resetAllMocks();
  shared.hydrate.mockResolvedValue(owner);
  shared.parse.mockImplementation((value: unknown) => ({ success: true, data: value }));
  shared.executable.mockReturnValue(true);
  shared.validate.mockReturnValue(ok(definition));
});

function database({
  workflow = [{ ownerId, publishedNumber: 3 }],
  publication = [{ definition, createdAt: publishedAt }],
  receipts = [],
  databaseTime = nowMs,
}: {
  workflow?: unknown[];
  publication?: unknown[];
  receipts?: unknown[];
  databaseTime?: number;
} = {}) {
  const rows = new Map<object, unknown[]>([
    [workflows, workflow],
    [workflowVersions, publication],
    [workflowRuns, receipts],
  ]);
  const locks = vi.fn<(table: object, mode: string) => void>();
  const filters = new Map<object, SQL>();
  const tx = {
    select: () => ({
      from: (table: object) => ({
        where: (predicate: SQL) => {
          filters.set(table, predicate);
          const selected = Promise.resolve(rows.get(table) ?? []);
          return Object.assign(selected, {
            for: (mode: string) => {
              locks(table, mode);
              return selected;
            },
            limit: () => selected,
          });
        },
      }),
    }),
    execute: vi.fn(() => Promise.resolve({ rows: [{ milliseconds: databaseTime }] })),
  };
  const db = {
    transaction: (execute: (value: typeof tx) => Promise<unknown>) => execute(tx),
  } as unknown as Db;
  const insert = vi.fn<InsertScheduledWorkflowRun>().mockResolvedValue({ id: runId });
  return { db, tx, locks, filters, insert };
}

it("derives a stable UUID request key for one workflow and UTC minute across versions", () => {
  const key = workflowScheduleRequestKey(occurrence);
  expect(z.uuid({ version: "v8" }).safeParse(key).success).toBe(true);
  expect(workflowScheduleRequestKey({ ...occurrence })).toBe(key);
  const republished = { ...occurrence, versionId: runId };
  expect(workflowScheduleRequestKey(republished)).toBe(key);
  expect(workflowScheduleRequestKey({ ...occurrence, workflowId: runId })).not.toBe(key);
  expect(
    workflowScheduleRequestKey({ ...occurrence, scheduledAt: "2026-11-02T09:10:00.000Z" }),
  ).not.toBe(key);
});

it("locks the active workflow and admits the exact occurrence as its current authorized owner", async () => {
  const test = database();
  expect(await admitScheduledWorkflowOccurrence(test.db, occurrence, test.insert, signal)).toEqual(
    ok(runId),
  );
  expect(test.locks).toHaveBeenCalledExactlyOnceWith(workflows, "update");
  expect(shared.hydrate).toHaveBeenCalledExactlyOnceWith(test.tx, ownerId, signal);
  const publicationFilter = test.filters.get(workflowVersions);
  assert(publicationFilter !== undefined);
  expect(new PgDialect().sqlToQuery(publicationFilter).params).toEqual([versionId, workflowId, 3]);
  expect(test.insert).toHaveBeenCalledExactlyOnceWith(test.tx, {
    workflowId,
    versionId,
    actorId: ownerId,
    requestKey: workflowScheduleRequestKey(occurrence),
    mode: "live",
    trigger: { scope: "schedule", scheduledAt },
    nextNodeId: "start",
  });
});

it.each([
  { override: { workflow: [] }, error: ERROR_IDS.WORKFLOW_DENIED },
  { override: { publication: [] }, error: ERROR_IDS.WORKFLOW_CONFLICT },
  {
    override: { publication: [{ definition, createdAt: new Date(nowMs) }] },
    error: ERROR_IDS.WORKFLOW_NOT_READY,
  },
  { override: { databaseTime: nowMs + 60_000 }, error: ERROR_IDS.WORKFLOW_NOT_READY },
  { override: { databaseTime: nowMs - 60_000 }, error: ERROR_IDS.WORKFLOW_NOT_READY },
])(
  "does not insert for an inactive, stale, early, or expired occurrence",
  async ({ override, error }) => {
    const test = database(override);
    expect(
      await admitScheduledWorkflowOccurrence(test.db, occurrence, test.insert, signal),
    ).toEqual(err(error));
    expect(test.insert).not.toHaveBeenCalled();
  },
);

it("denies missing or deauthorized ownership and rejects caller-supplied authority", async () => {
  const test = database();
  expect(
    await admitScheduledWorkflowOccurrence(
      test.db,
      { ...occurrence, actorId: ownerId },
      test.insert,
      signal,
    ),
  ).toEqual(err(ERROR_IDS.WORKFLOW_INVALID));
  expect(test.locks).not.toHaveBeenCalled();
  shared.hydrate.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...owner, flags: new Set() });
  for (let attempt = 0; attempt < 2; attempt++) {
    expect(
      await admitScheduledWorkflowOccurrence(test.db, occurrence, test.insert, signal),
    ).toEqual(err(ERROR_IDS.WORKFLOW_DENIED));
  }
  expect(test.insert).not.toHaveBeenCalled();
});

it("requires Form owners to be able to view the scheduled run they must answer", async () => {
  const form = { ...definition.nodes[0], id: "form", type: "human.form" };
  const withForm = { ...definition, nodes: [...definition.nodes, form] };
  const test = database({ publication: [{ definition: withForm, createdAt: publishedAt }] });
  expect(await admitScheduledWorkflowOccurrence(test.db, occurrence, test.insert, signal)).toEqual(
    err(ERROR_IDS.WORKFLOW_DENIED),
  );
  expect(test.insert).not.toHaveBeenCalled();
  shared.hydrate.mockResolvedValue({ ...owner, flags: new Set(["workflow.run", "workflow.view"]) });
  expect(await admitScheduledWorkflowOccurrence(test.db, occurrence, test.insert, signal)).toEqual(
    ok(runId),
  );
});

it("replays a matching receipt after the minute and fails closed on a mismatched owner or context", async () => {
  const receipt = {
    id: runId,
    versionId,
    actorId: ownerId,
    mode: "live",
    trigger: { scope: "schedule", scheduledAt },
  };
  const replay = database({ receipts: [receipt], databaseTime: nowMs + 60_000 });
  expect(
    await admitScheduledWorkflowOccurrence(replay.db, occurrence, replay.insert, signal),
  ).toEqual(ok(runId));
  expect(replay.insert).not.toHaveBeenCalled();
  expect(replay.tx.execute).not.toHaveBeenCalled();
  for (const forged of [
    { ...receipt, actorId: workflowId },
    { ...receipt, versionId: workflowId },
    { ...receipt, trigger: { ...receipt.trigger, recordId: workflowId } },
  ]) {
    const conflict = database({ receipts: [forged] });
    expect(
      await admitScheduledWorkflowOccurrence(conflict.db, occurrence, conflict.insert, signal),
    ).toEqual(err(ERROR_IDS.WORKFLOW_CONFLICT));
    expect(conflict.insert).not.toHaveBeenCalled();
  }
});

it("discovers only due publications and returns a keyset cursor even when most rows are skipped", async () => {
  const afterId = "00000000-0000-4000-8000-000000000000";
  const rows = Array.from({ length: 50 }, (_, index) => ({
    workflowId: `00000000-0000-4000-8000-${(index + 1).toString().padStart(12, "0")}`,
    versionId,
    definition,
    publishedAt: index === 0 ? publishedAt : new Date(nowMs),
    nowMs,
  }));
  const limit = vi.fn(() => Promise.resolve(rows));
  const where = vi
    .fn<(filter: SQL) => { orderBy: () => { limit: typeof limit } }>()
    .mockReturnValue({ orderBy: () => ({ limit }) });
  const select = () => ({ from: () => ({ innerJoin: () => ({ where }) }) });
  const db = { select } as unknown as Db;
  expect(await readDueScheduledWorkflowPage(db, afterId, signal)).toEqual({
    occurrences: [{ workflowId: rows[0]?.workflowId, versionId, scheduledAt }],
    nextAfterId: rows.at(-1)?.workflowId,
    scheduledAt,
  });
  expect(limit).toHaveBeenCalledExactlyOnceWith(50);
  const filter = where.mock.calls[0]?.[0];
  assert(filter !== undefined);
  const query = new PgDialect().sqlToQuery(filter);
  expect(query.params).toEqual([true, afterId]);
  expect(query.sql).toContain("trigger.schedule");
  expect(
    await readDueScheduledWorkflowPage(db, afterId, signal, "2026-11-02T09:04:00.000Z"),
  ).toEqual({
    occurrences: [],
    nextAfterId: null,
    scheduledAt,
  });
});
