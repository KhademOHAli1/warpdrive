import { beforeEach, describe, expect, it, vi } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import type { workflows } from "@/db/schema";
import type { HydratedActor, hydrateActor } from "@/server/hydrateActor";
import { readRunHistoryPage } from "./runHistoryPage";
import { hydrateRunHistoryRows, type RunHistorySourceRow } from "./runHistoryProjection";
import type { describeRunRecovery, readFailureHistories } from "./runRecovery";

const boundary = vi.hoisted(() => ({
  actor: vi.fn<typeof hydrateActor>(),
  failures: vi.fn<typeof readFailureHistories>(),
  recovery: vi.fn<typeof describeRunRecovery>(),
}));
vi.mock("@/server/hydrateActor", () => ({ hydrateActor: boundary.actor }));
vi.mock("./runRecovery", () => ({
  readFailureHistories: boundary.failures,
  describeRunRecovery: boundary.recovery,
}));

const id = "cb001f5a-b8a4-49fc-88d9-eccb94c9a773";
const actor: HydratedActor = {
  id: "64d7f11d-5838-4fe2-8a11-3c6116bf715f",
  type: "regular",
  isActive: true,
  flags: new Set(["workflow.view"]),
  groupIds: new Set(),
  managedUserIds: new Set(),
  name: "Reader",
  email: "reader@example.test",
  avatarUrl: null,
};
const now = new Date("2026-11-04T12:34:56.123Z");
const definition = {
  schemaVersion: 1 as const,
  nodes: [
    {
      id: "start",
      type: "trigger.manual" as const,
      version: 1 as const,
      name: "Private definition",
      config: {},
    },
  ],
  edges: [],
};
const workflow: typeof workflows.$inferSelect = {
  id,
  ownerId: actor.id,
  name: "Private name",
  revision: 1,
  draft: definition,
  publishedNumber: 1,
  active: true,
  archivedAt: null,
  createdAt: now,
  updatedAt: now,
};
function row(): RunHistorySourceRow {
  const run = {
    id: "afbb8905-fb1a-4c92-ad54-64a366146723",
    workflowId: id,
    versionId: "76d26d76-66ae-42df-b75e-c0fb28fa617f",
    actorId: actor.id,
    requestKey: "5bc3f2b4-8cdd-4d63-a054-6fbc7c88aaff",
    mode: "live" as const,
    status: "queued" as const,
    trigger: { recordId: "private-record-id" },
    nextNodeId: "start",
    iteratorFrame: null,
    resumeAt: null,
    outputs: { start: { secret: "private-output" } },
    errorId: null,
    cancelledBy: null,
    cancelledAt: null,
    createdAt: now,
    updatedAt: now,
  };
  return {
    id: run.id,
    status: run.status,
    mode: run.mode,
    resumeAt: run.resumeAt,
    versionId: run.versionId,
    errorId: run.errorId,
    createdAt: now,
    updatedAt: now,
    run,
    definition,
  };
}
function stepDb() {
  const steps = [
    {
      id: "step-private",
      runId: row().id,
      nodeId: "start",
      iterationIndex: -1,
      outcome: "succeeded",
      errorId: null,
      simulated: false,
      output: { private: "private-step-output" },
      completedAt: now,
    },
  ];
  const orderBy = vi.fn(() => Promise.resolve(steps));
  const select = vi.fn(() => ({ from: () => ({ where: () => ({ orderBy }) }) }));
  return { db: { select } as unknown as Db, select, steps };
}
function authorityDb(rows: (typeof workflows.$inferSelect)[]) {
  const limit = vi.fn(() => Promise.resolve(rows));
  const select = vi.fn(() => ({ from: () => ({ where: () => ({ limit }) }) }));
  return { db: { select } as unknown as Db, select, limit };
}

beforeEach(() => {
  vi.resetAllMocks();
  boundary.actor.mockResolvedValue(actor);
  boundary.failures.mockResolvedValue(new Map());
  boundary.recovery.mockResolvedValue(null);
});

describe("exact legacy run-history public projection", () => {
  it("strips private/raw cursor fields and step payloads without mutating source rows", async () => {
    const test = stepDb();
    const input = Object.freeze({
      ...row(),
      cursorCreatedAt: "2026-11-04T12:34:56.123456Z",
      extra: "private-extra",
      trigger: { recordId: "private-top-level" },
    });
    const before = structuredClone(input);
    const result = await hydrateRunHistoryRows(
      test.db,
      actor,
      workflow,
      [input],
      new AbortController().signal,
    );
    expect(result).toEqual([
      {
        id: input.id,
        status: "queued",
        mode: "live",
        resumeAt: null,
        versionId: input.versionId,
        errorId: null,
        createdAt: now,
        updatedAt: now,
        steps: [{ nodeId: "start", simulated: false, completedAt: now }],
      },
    ]);
    expect(JSON.stringify(result)).not.toMatch(
      /private|cursorCreatedAt|requestKey|actorId|definition|outputs|trigger/,
    );
    expect(input).toEqual(before);
    expect(result[0]).not.toBe(input);
    expect(boundary.failures).toHaveBeenCalledExactlyOnceWith(
      test.db,
      [input.id],
      expect.any(AbortSignal),
    );
    expect(boundary.recovery).toHaveBeenCalledExactlyOnceWith(
      test.db,
      actor,
      workflow,
      input.run,
      input.definition,
      test.steps,
      [],
      expect.any(AbortSignal),
    );
  });

  it("retains the existing safe recovery descriptor without widening it", async () => {
    const test = stepDb();
    const recovery = { eligible: false, failureId: null, reason: "legacy" as const, history: [] };
    boundary.recovery.mockResolvedValue(recovery);
    const result = await hydrateRunHistoryRows(
      test.db,
      actor,
      workflow,
      [row()],
      new AbortController().signal,
    );
    expect(result[0]?.recovery).toEqual(recovery);
    expect(Object.keys(result[0] ?? {}).sort()).toEqual([
      "createdAt",
      "errorId",
      "id",
      "mode",
      "recovery",
      "resumeAt",
      "status",
      "steps",
      "updatedAt",
      "versionId",
    ]);
  });

  it("propagates cancellation before any hydration query", async () => {
    const test = stepDb();
    const reason = new Error("cancelled history read");
    await expect(
      hydrateRunHistoryRows(test.db, actor, workflow, [row()], AbortSignal.abort(reason)),
    ).rejects.toBe(reason);
    expect(test.select).not.toHaveBeenCalled();
    expect(boundary.failures).not.toHaveBeenCalled();
  });
});

describe("current authorization precedes cursor interpretation", () => {
  it("denies an inactive/deleted current actor before workflow or cursor reads", async () => {
    boundary.actor.mockResolvedValue(null);
    const test = authorityDb([workflow]);
    expect(
      await readRunHistoryPage(test.db, actor, new AbortController().signal, {
        id,
        cursor: "!bad",
      }),
    ).toEqual({ ok: false, error: ERROR_IDS.WORKFLOW_DENIED });
    expect(test.select).not.toHaveBeenCalled();
  });

  it.each(["missing", "other-owner", "revoked"] as const)(
    "denies %s authority before malformed cursor diagnostics",
    async (cause) => {
      const current = cause === "revoked" ? { ...actor, flags: new Set<never>() } : actor;
      boundary.actor.mockResolvedValue(current);
      const test = authorityDb(
        cause === "missing"
          ? []
          : [{ ...workflow, ownerId: cause === "other-owner" ? id : actor.id }],
      );
      expect(
        await readRunHistoryPage(test.db, actor, new AbortController().signal, {
          id,
          cursor: "!bad",
        }),
      ).toEqual({ ok: false, error: ERROR_IDS.WORKFLOW_DENIED });
      expect(test.select).toHaveBeenCalledTimes(1);
      expect(boundary.failures).not.toHaveBeenCalled();
    },
  );

  it("rejects a malformed cursor after authorized archived-workflow lookup without history reads", async () => {
    const test = authorityDb([{ ...workflow, active: false, archivedAt: now }]);
    expect(
      await readRunHistoryPage(test.db, actor, new AbortController().signal, {
        id,
        cursor: "!bad",
      }),
    ).toEqual({ ok: false, error: ERROR_IDS.WORKFLOW_INVALID });
    expect(test.select).toHaveBeenCalledTimes(1);
    expect(boundary.failures).not.toHaveBeenCalled();
  });

  it("propagates entry cancellation without consulting cached actor authority", async () => {
    const test = authorityDb([workflow]);
    const reason = new Error("cancelled entry");
    await expect(
      readRunHistoryPage(test.db, actor, AbortSignal.abort(reason), { id }),
    ).rejects.toBe(reason);
    expect(boundary.actor).not.toHaveBeenCalled();
    expect(test.select).not.toHaveBeenCalled();
  });
});
