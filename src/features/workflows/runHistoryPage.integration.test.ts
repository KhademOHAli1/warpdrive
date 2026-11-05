import { eq } from "drizzle-orm";
import { assert, expect, it } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import { permissionSets, users, workflowRuns, workflows } from "@/db/schema";
import { hydrateActor } from "@/server/hydrateActor";
import { admitManualRun, advanceWorkflowRun } from "./execution";
import { archiveWorkflow } from "./lifecycle";
import { readRunHistory } from "./queries";
import { cancelWorkflowRun } from "./runControl";
import { readRunHistoryPage } from "./runHistoryPage";
import {
  HISTORY_TEST_TIMEOUT,
  historicalSpecs,
  historyCursorBody,
  historyPage,
  historySnapshot,
  loggedHistoryDb,
  publishHistoryWorkflow,
  seedHistoricalRuns,
  withHistory,
} from "./runHistoryPage.test-helpers";

// Frozen before fixture implementation. Native definitions are UNRUN until the
// integrator executes real PostgreSQL qualification, not future-import RED.
const denied = { ok: false, error: ERROR_IDS.WORKFLOW_DENIED };
const invalid = { ok: false, error: ERROR_IDS.WORKFLOW_INVALID };
const statuses = ["queued", "running", "waiting", "succeeded", "failed", "cancelled"] as const;

it(
  "pages 61 pinned runs as 50 plus 11 without changing the legacy array or stored history",
  async () => {
    await withHistory(async (test, signal) => {
      const rows = await seedHistoricalRuns(test, historicalSpecs(61));
      const before = await historySnapshot(test.db);
      const first = await historyPage(test, signal);
      expect(first.items.map((row) => row.id)).toEqual(
        rows
          .slice()
          .reverse()
          .slice(0, 50)
          .map((row) => row.id),
      );
      assert(first.nextCursor !== null);
      const second = await historyPage(test, signal, { cursor: first.nextCursor });
      expect(second.items.map((row) => row.id)).toEqual(
        rows
          .slice()
          .reverse()
          .slice(50)
          .map((row) => row.id),
      );
      expect(second.nextCursor).toBeNull();
      const ids = [...first.items, ...second.items].map((row) => row.id);
      expect(new Set(ids).size).toBe(61);
      const legacy = await readRunHistory(test.db, test.actor, test.workflow.id, signal);
      expect(legacy).toEqual({ ok: true, value: first.items });
      expect(Array.isArray(legacy.ok ? legacy.value : null)).toBe(true);
      expect(await historySnapshot(test.db)).toEqual(before);
    });
  },
  HISTORY_TEST_TIMEOUT,
);

it(
  "orders equal PostgreSQL timestamps by UUID descending across the 50-row boundary",
  async () => {
    await withHistory(async (test, signal) => {
      const specs = historicalSpecs(61).map((row, index) => ({
        ...row,
        id: "00000000-0000-4000-8000-" + String(index + 1).padStart(12, "0"),
        createdAt: "2026-11-01T00:00:00.123456Z",
      }));
      await seedHistoricalRuns(test, specs);
      const first = await historyPage(test, signal);
      assert(first.nextCursor !== null);
      const second = await historyPage(test, signal, { cursor: first.nextCursor });
      expect([...first.items, ...second.items].map((row) => row.id)).toEqual(
        specs.map((row) => row.id).reverse(),
      );
      expect(second.nextCursor).toBeNull();
    });
  },
  HISTORY_TEST_TIMEOUT,
);

it(
  "retains six cursor digits and all four sub-millisecond timestamp positions",
  async () => {
    await withHistory(async (test, signal) => {
      await seedHistoricalRuns(
        test,
        historicalSpecs(49).map((row) => ({
          ...row,
          createdAt: "2026-11-02T00:00:00.124000Z",
        })),
      );
      const stamps = [
        "2026-11-02T00:00:00.123900Z",
        "2026-11-02T00:00:00.123800Z",
        "2026-11-02T00:00:00.123700Z",
        "2026-11-02T00:00:00.122999Z",
      ];
      const fine = await seedHistoricalRuns(
        test,
        stamps.map((createdAt, index) => ({
          id: "00000000-0000-4000-8000-" + String(index + 1).padStart(12, "0"),
          createdAt,
        })),
      );
      const first = await historyPage(test, signal);
      expect(first.items.at(-1)?.id).toBe(fine[0]?.id);
      assert(first.nextCursor !== null);
      expect(historyCursorBody(first.nextCursor)).toMatchObject({
        key: { createdAt: stamps[0], id: fine[0]?.id },
      });
      const second = await historyPage(test, signal, { cursor: first.nextCursor });
      expect(second.items.map((row) => row.id)).toEqual(fine.slice(1).map((row) => row.id));
      expect(second.nextCursor).toBeNull();
      expect(first.items.at(-1)?.createdAt.toISOString()).toBe("2026-11-02T00:00:00.123Z");
      expect(second.items[0]?.createdAt.toISOString()).toBe("2026-11-02T00:00:00.123Z");
    });
  },
  HISTORY_TEST_TIMEOUT,
);

it(
  "applies every existing status and both execution modes without mixing hidden workflow rows",
  async () => {
    await withHistory(async (test, signal) => {
      const own = await seedHistoricalRuns(
        test,
        statuses.flatMap((status) => [
          { status, mode: "live" as const },
          { status, mode: "simulation" as const },
        ]),
      );
      const hidden = await publishHistoryWorkflow(test, test.outsider, "Hidden history");
      const hiddenRows = await seedHistoricalRuns(test, historicalSpecs(12), hidden);
      for (const status of statuses) {
        const page = await historyPage(test, signal, { status });
        expect(page.items.map((row) => row.id).sort()).toEqual(
          own
            .filter((row) => row.status === status)
            .map((row) => row.id)
            .sort(),
        );
        expect(page.items.map((row) => row.mode).sort()).toEqual(["live", "simulation"]);
        expect(page.nextCursor).toBeNull();
        for (const row of hiddenRows) expect(JSON.stringify(page)).not.toContain(row.id);
      }
    });
  },
  HISTORY_TEST_TIMEOUT,
);

it.each([
  { status: "waiting", mode: "live" },
  { status: "failed", mode: "simulation" },
  { status: "all", mode: "live" },
  { status: "succeeded", mode: "all" },
] as const)(
  "applies combined status=$status mode=$mode before the fixed page bound",
  async (filter) => {
    await withHistory(async (test, signal) => {
      const rows = await seedHistoricalRuns(
        test,
        historicalSpecs(72).map((row, index) => ({
          ...row,
          status: statuses[Math.floor(index / 2) % statuses.length],
          mode: index % 2 === 0 ? ("live" as const) : ("simulation" as const),
        })),
      );
      const page = await historyPage(test, signal, filter);
      const expected = rows
        .filter(
          (row) =>
            (filter.status === "all" || row.status === filter.status) &&
            (filter.mode === "all" || row.mode === filter.mode),
        )
        .reverse();
      expect(page.items.map((row) => row.id)).toEqual(expected.map((row) => row.id));
      expect(page.nextCursor).toBeNull();
    });
  },
  HISTORY_TEST_TIMEOUT,
);

it(
  "normalizes omitted all filters and workflow UUID casing to the same continuation context",
  async () => {
    await withHistory(async (test, signal) => {
      await seedHistoricalRuns(test, historicalSpecs(61));
      const first = await historyPage(test, signal);
      expect(await historyPage(test, signal, { status: "all", mode: "all" })).toEqual(first);
      assert(first.nextCursor !== null);
      const expected = await historyPage(test, signal, { cursor: first.nextCursor });
      expect(
        await readRunHistoryPage(test.db, test.actor, signal, {
          id: test.workflow.id.toUpperCase(),
          status: "all",
          mode: "all",
          cursor: first.nextCursor,
        }),
      ).toEqual({ ok: true, value: expected });
    });
  },
  HISTORY_TEST_TIMEOUT,
);

it(
  "rejects unknown fields, caller limits and invalid outer input without writes",
  async () => {
    await withHistory(async (test, signal) => {
      const before = await historySnapshot(test.db);
      const inputs: unknown[] = [
        undefined,
        null,
        [],
        {},
        { id: "not-a-uuid" },
        { id: test.workflow.id, status: "needs-review" },
        { id: test.workflow.id, mode: "test" },
        { id: test.workflow.id, limit: 1 },
        { id: test.workflow.id, extra: true },
        { id: test.workflow.id, cursor: null },
        { id: test.workflow.id, cursor: 1 },
        { id: test.workflow.id, cursor: "" },
        { id: test.workflow.id, cursor: "x".repeat(4097) },
      ];
      for (const input of inputs)
        expect(await readRunHistoryPage(test.db, test.actor, signal, input)).toEqual(invalid);
      expect(await historySnapshot(test.db)).toEqual(before);
    });
  },
  HISTORY_TEST_TIMEOUT,
);

it(
  "rejects malformed and wrong-domain cursors after authorized workflow lookup",
  async () => {
    await withHistory(async (test, signal) => {
      await seedHistoricalRuns(test, historicalSpecs(51));
      const first = await historyPage(test, signal);
      assert(first.nextCursor !== null);
      const before = await historySnapshot(test.db);
      const cursors = [
        "not-a-cursor",
        first.nextCursor + "=",
        Buffer.from("null").toString("base64url"),
        Buffer.from(JSON.stringify({ version: 99, kind: "workflow-runs" })).toString("base64url"),
        Buffer.from(JSON.stringify({ version: 1, kind: "workflows" })).toString("base64url"),
        Buffer.from(
          JSON.stringify({ ...historyCursorBody(first.nextCursor), extra: true }),
        ).toString("base64url"),
      ];
      for (const cursor of cursors)
        expect(
          await readRunHistoryPage(test.db, test.actor, signal, {
            id: test.workflow.id,
            cursor,
          }),
        ).toEqual(invalid);
      expect(await historySnapshot(test.db)).toEqual(before);
    });
  },
  HISTORY_TEST_TIMEOUT,
);

it(
  "binds continuations to normalized status, mode, workflow and actor",
  async () => {
    await withHistory(async (test, signal) => {
      await seedHistoricalRuns(test, historicalSpecs(61));
      const first = await historyPage(test, signal);
      assert(first.nextCursor !== null);
      const other = await publishHistoryWorkflow(test, test.actor, "Another authorized history");
      for (const input of [
        { id: test.workflow.id, status: "waiting", cursor: first.nextCursor },
        { id: test.workflow.id, mode: "simulation", cursor: first.nextCursor },
        { id: other.workflow.id, cursor: first.nextCursor },
      ])
        expect(await readRunHistoryPage(test.db, test.actor, signal, input)).toEqual(invalid);
      expect(
        await readRunHistoryPage(test.db, test.admin, signal, {
          id: test.workflow.id,
          cursor: first.nextCursor,
        }),
      ).toEqual(invalid);
    });
  },
  HISTORY_TEST_TIMEOUT,
);

it.each([false, true])(
  "binds continuation to current actor scope before isAdmin changes from %s",
  async (initialAdmin) => {
    await withHistory(async (test, signal) => {
      await test.db.update(users).set({ isAdmin: initialAdmin }).where(eq(users.id, test.actor.id));
      await seedHistoricalRuns(test, historicalSpecs(51));
      const first = await historyPage(test, signal);
      assert(first.nextCursor !== null);
      await test.db
        .update(users)
        .set({ isAdmin: !initialAdmin })
        .where(eq(users.id, test.actor.id));
      expect(
        await readRunHistoryPage(test.db, test.actor, signal, {
          id: test.workflow.id,
          cursor: first.nextCursor,
        }),
      ).toEqual(invalid);
      expect((await historyPage(test, signal)).items).toHaveLength(50);
    });
  },
  HISTORY_TEST_TIMEOUT,
);

it(
  "binds an administrator cursor to the current workflow owner and denies the previous regular owner",
  async () => {
    await withHistory(async (test, signal) => {
      await seedHistoricalRuns(test, historicalSpecs(51));
      const first = await historyPage(test, signal, {}, test.admin);
      assert(first.nextCursor !== null);
      await test.db
        .update(workflows)
        .set({ ownerId: test.outsider.id })
        .where(eq(workflows.id, test.workflow.id));
      expect(
        await readRunHistoryPage(test.db, test.admin, signal, {
          id: test.workflow.id,
          cursor: first.nextCursor,
        }),
      ).toEqual(invalid);
      expect(
        await readRunHistoryPage(test.db, test.actor, signal, {
          id: test.workflow.id,
          cursor: "malformed",
        }),
      ).toEqual(denied);
      expect((await historyPage(test, signal, {}, test.outsider)).items).toHaveLength(50);
    });
  },
  HISTORY_TEST_TIMEOUT,
);

it.each([
  "owner-inactive",
  "owner-view-revoked",
  "admin-inactive",
  "admin-demoted",
  "outsider",
  "missing-workflow",
] as const)(
  "checks current authority before cursor decoding for %s",
  async (reason) => {
    await withHistory(async (test, signal) => {
      let actor = test.actor;
      let id = test.workflow.id;
      if (reason === "owner-inactive")
        await test.db.update(users).set({ isActive: false }).where(eq(users.id, actor.id));
      if (reason === "owner-view-revoked")
        await test.db
          .update(permissionSets)
          .set({ flags: { "workflow.create": true } })
          .where(eq(permissionSets.id, test.permissions.id));
      if (reason === "admin-inactive") {
        actor = test.admin;
        await test.db.update(users).set({ isActive: false }).where(eq(users.id, actor.id));
      }
      if (reason === "admin-demoted") {
        actor = test.admin;
        await test.db.update(users).set({ isAdmin: false }).where(eq(users.id, actor.id));
      }
      if (reason === "outsider") actor = test.outsider;
      if (reason === "missing-workflow") id = crypto.randomUUID();
      const before = await historySnapshot(test.db);
      const observed = loggedHistoryDb(test.pool);
      expect(
        await readRunHistoryPage(observed.db, actor, signal, { id, cursor: "malformed" }),
      ).toEqual(denied);
      expect(observed.queries.some((entry) => entry.query.includes('"workflow_runs"'))).toBe(false);
      expect(await historySnapshot(test.db)).toEqual(before);
    });
  },
  HISTORY_TEST_TIMEOUT,
);

it.each(["owner", "admin"] as const)(
  "retains authorized archived history for %s before applying cursor validation",
  async (kind) => {
    await withHistory(async (test, signal) => {
      await seedHistoricalRuns(test, historicalSpecs(61));
      const archived = await archiveWorkflow(
        test.db,
        test.actor,
        {
          id: test.workflow.id,
          revision: test.workflow.revision,
        },
        signal,
      );
      assert(archived.ok);
      const actor = kind === "owner" ? test.actor : test.admin;
      const first = await historyPage(test, signal, {}, actor);
      expect(first.items).toHaveLength(50);
      assert(first.nextCursor !== null);
      expect(
        (await historyPage(test, signal, { cursor: first.nextCursor }, actor)).items,
      ).toHaveLength(11);
      expect(
        await readRunHistoryPage(test.db, actor, signal, {
          id: test.workflow.id,
          cursor: "malformed",
        }),
      ).toEqual(invalid);
      expect(
        await readRunHistoryPage(test.db, test.outsider, signal, {
          id: test.workflow.id,
          cursor: "malformed",
        }),
      ).toEqual(denied);
    });
  },
  HISTORY_TEST_TIMEOUT,
);

it(
  "treats status-filter continuation as a live view without repeating already displayed rows",
  async () => {
    await withHistory(async (test, signal) => {
      await seedHistoricalRuns(
        test,
        historicalSpecs(61).map((row) => ({ ...row, status: "waiting" as const })),
      );
      const first = await historyPage(test, signal, { status: "waiting" });
      assert(first.nextCursor !== null);
      const last = first.items.at(-1);
      const shown = first.items[0];
      assert(last !== undefined && shown !== undefined);
      await test.db
        .update(workflowRuns)
        .set({ status: "failed", resumeAt: null })
        .where(eq(workflowRuns.id, shown.id));
      const removed = await historyPage(test, signal, {
        status: "waiting",
        cursor: first.nextCursor,
      });
      const older = removed.items[0];
      assert(older !== undefined);
      await test.db
        .update(workflowRuns)
        .set({ status: "failed", resumeAt: null })
        .where(eq(workflowRuns.id, older.id));
      await test.db
        .update(workflowRuns)
        .set({ status: "waiting", resumeAt: new Date("2099-01-01T00:00:00Z") })
        .where(eq(workflowRuns.id, shown.id));
      const next = await historyPage(test, signal, { status: "waiting", cursor: first.nextCursor });
      expect(next.items).toHaveLength(10);
      expect(next.items.some((row) => first.items.some((prior) => prior.id === row.id))).toBe(
        false,
      );
      expect(next.items.some((row) => row.id === older.id)).toBe(false);
      expect((await historyPage(test, signal, { status: "waiting" })).items[0]?.id).toBe(shown.id);
    });
  },
  HISTORY_TEST_TIMEOUT,
);

it(
  "shows new older inserts on continuation while newer inserts require a fresh first page",
  async () => {
    await withHistory(async (test, signal) => {
      await seedHistoricalRuns(test, historicalSpecs(61));
      const first = await historyPage(test, signal);
      assert(first.nextCursor !== null);
      const added = await seedHistoricalRuns(test, [
        { createdAt: "2026-11-05T00:00:00.000000Z" },
        { createdAt: "2026-10-01T00:00:00.000000Z" },
      ]);
      const next = await historyPage(test, signal, { cursor: first.nextCursor });
      expect(next.items).toHaveLength(12);
      expect(next.items.some((row) => row.id === added[0]?.id)).toBe(false);
      expect(next.items.at(-1)?.id).toBe(added[1]?.id);
      expect((await historyPage(test, signal)).items[0]?.id).toBe(added[0]?.id);
    });
  },
  HISTORY_TEST_TIMEOUT,
);

it(
  "hydrates only 50 displayed runs and excludes the lookahead run from step and failure queries",
  async () => {
    await withHistory(async (test, signal) => {
      const rows = await seedHistoricalRuns(test, historicalSpecs(51));
      const observed = loggedHistoryDb(test.pool);
      const result = await readRunHistoryPage(observed.db, test.actor, signal, {
        id: test.workflow.id,
      });
      assert(result.ok);
      const lookahead = rows[0];
      assert(lookahead !== undefined);
      const stepQueries = observed.queries.filter((entry) =>
        entry.query.includes('"workflow_steps"'),
      );
      const failureQueries = observed.queries.filter((entry) =>
        entry.query.includes('"workflow_run_failures"'),
      );
      expect(stepQueries.length).toBeGreaterThan(0);
      expect(failureQueries.length).toBeGreaterThan(0);
      const stepParameters = stepQueries.flatMap((entry) => entry.params);
      const failureParameters = failureQueries.flatMap((entry) => entry.params);
      for (const row of result.value.items) {
        expect(stepParameters).toContain(row.id);
        expect(failureParameters).toContain(row.id);
      }
      expect(stepParameters).not.toContain(lookahead.id);
      expect(failureParameters).not.toContain(lookahead.id);
      expect(result.value.items).toHaveLength(50);
      expect(result.value.nextCursor).not.toBeNull();
    });
  },
  HISTORY_TEST_TIMEOUT,
);

it(
  "returns exactly the legacy safe projection without stored trigger, CRM outputs or private identifiers",
  async () => {
    await withHistory(async (test, signal) => {
      await seedHistoricalRuns(test, [{ status: "succeeded" }, { status: "failed" }]);
      const page = await historyPage(test, signal);
      const legacy = await readRunHistory(test.db, test.actor, test.workflow.id, signal);
      expect(legacy).toEqual({ ok: true, value: page.items });
      for (const row of page.items) {
        expect(
          Object.keys(row)
            .filter((key) => key !== "recovery")
            .sort(),
        ).toEqual([
          "createdAt",
          "errorId",
          "id",
          "mode",
          "resumeAt",
          "status",
          "steps",
          "updatedAt",
          "versionId",
        ]);
        for (const step of row.steps)
          expect(Object.keys(step).sort()).toEqual(["completedAt", "nodeId", "simulated"]);
      }
      const serialized = JSON.stringify(page);
      for (const privateValue of [
        test.deal.id,
        test.deal.title,
        test.actor.id,
        "private-history-output",
        "requestKey",
        "trigger",
        "outputs",
        "definition",
        "retryRequestKey",
      ]) {
        expect(serialized).not.toContain(privateValue);
      }
    });
  },
  HISTORY_TEST_TIMEOUT,
);

it(
  "keeps actual public admission, duration deadlines and cancellation behavior unchanged",
  async () => {
    await withHistory(async (test, signal) => {
      const admitted = await admitManualRun(
        test.db,
        test.actor,
        {
          workflowId: test.workflow.id,
          requestKey: crypto.randomUUID(),
          recordId: test.deal.id,
          mode: "live",
        },
        signal,
      );
      assert(admitted.ok);
      for (let index = 0; index < 3; index++) {
        const advanced = await advanceWorkflowRun(test.db, admitted.value.id, signal);
        assert(advanced.ok);
      }
      const waiting = await historyPage(test, signal);
      expect(waiting.items[0]).toMatchObject({ id: admitted.value.id, status: "waiting" });
      expect(waiting.items[0]?.resumeAt).toBeInstanceOf(Date);
      const before = await historySnapshot(test.db);
      expect(waiting.items[0]?.resumeAt).toEqual(
        before.runs.find((row) => row.id === admitted.value.id)?.resumeAt,
      );
      expect(await readRunHistory(test.db, test.actor, test.workflow.id, signal)).toEqual({
        ok: true,
        value: waiting.items,
      });
      expect(await historySnapshot(test.db)).toEqual(before);
      expect(await cancelWorkflowRun(test.db, test.actor, admitted.value.id, signal)).toEqual({
        ok: true,
        value: "cancelled",
      });
      const cancelled = await historyPage(test, signal);
      expect(cancelled.items[0]).toMatchObject({
        id: admitted.value.id,
        status: "cancelled",
        resumeAt: null,
      });
      expect(cancelled.items[0]?.steps).toEqual(waiting.items[0]?.steps);
    });
  },
  HISTORY_TEST_TIMEOUT,
);

it(
  "propagates an exact pre-aborted signal before history I/O",
  async () => {
    await withHistory(async (test) => {
      const controller = new AbortController();
      const reason = new DOMException("History page abandoned", "AbortError");
      controller.abort(reason);
      const observed = loggedHistoryDb(test.pool);
      await expect(
        readRunHistoryPage(observed.db, test.actor, controller.signal, { id: test.workflow.id }),
      ).rejects.toBe(reason);
      expect(observed.queries).toEqual([]);
      expect(
        await hydrateActor(test.db, test.actor.id, new AbortController().signal),
      ).not.toBeNull();
    });
  },
  HISTORY_TEST_TIMEOUT,
);
