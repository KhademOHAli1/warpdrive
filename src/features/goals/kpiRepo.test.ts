// @vitest-environment node
// Native PostgreSQL regression suite against the canonical migrated disposable database.
// These tests cover source behavior, not release or installed-app acceptance. Request transport is substituted;
// CSRF validation, permission checks, repositories, transactions and SQL remain real.
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import type { PermSetUser } from "@/features/permissions/effective";
import {
  seedActivityType,
  seedDeal,
  seedPipeline,
  seedUser,
  toActor,
} from "@/features/stats/statsTestHelpers";
import { makeTestDb, type TestDb } from "@/test/db";
import type { KpiActionResult, KpiDefinitionInput, KpiGoalInput, KpiPeriod } from "./kpiModel";

const request = vi.hoisted(() => ({
  db: null as Db | null,
  actor: null as PermSetUser | null,
  headers: new Map<string, string>(),
  cookies: new Map<string, string>(),
}));
vi.mock("next/headers", () => ({
  headers: () =>
    Promise.resolve({ get: (key: string) => request.headers.get(key.toLowerCase()) ?? null }),
  cookies: () =>
    Promise.resolve({
      get: (key: string) => {
        const value = request.cookies.get(key);
        return value === undefined ? undefined : { value };
      },
    }),
}));
vi.mock("@/server/trpc/context", () => ({
  createContext: () => {
    if (!request.db) throw new Error("Native KPI test database is unbound");
    return Promise.resolve({
      db: request.db,
      actor: request.actor,
      session: request.actor
        ? { userId: request.actor.id, sessionId: "native-test-request" }
        : null,
    });
  },
}));

import {
  applyKpiSchemeAction,
  closeKpiPeriodAction,
  createKpiGoalAction,
  createKpiPackAction,
  recordKpiMeasurementAction,
  saveKpiDefinitionAction,
} from "./kpiActions";
import {
  assignKpiGoal,
  evaluateKpi,
  getKpiDefinition,
  kpiScopeVisible,
  readKpiGoalResult,
  readKpiWorkspace,
  saveKpiDefinition,
  saveKpiScheme,
} from "./kpiRepo";

const CSRF = "native-kpi-csrf-token";
const SIGNAL = () => AbortSignal.timeout(15000);
const PERIOD: KpiPeriod = { kind: "calendar", interval: "monthly", startsOn: "2026-11-01" };
const CLOCK = { day: "2026-11-05", instant: "2026-11-05T16:00:00Z", timeZone: "Europe/Berlin" };
const COMPANY = { scope: "company" as const, scopeId: null };
const DEFINITION: KpiDefinitionInput = {
  name: "Won deal value",
  description: "CRM won deal value, not invoiced revenue",
  source: "deals",
  calculation: "sum",
  unit: "money",
  currency: "EUR",
  dateField: "closed",
  filters: { status: "won" },
  valueField: "value",
};
const COUNT: KpiDefinitionInput = {
  name: "Won deals",
  description: "",
  source: "deals",
  calculation: "count",
  unit: "count",
  dateField: "closed",
  filters: { status: "won" },
};
let h: TestDb;
let admin: PermSetUser;

function success<T>(result: KpiActionResult<T>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.id);
  return result.value;
}
function goalInput(definitionId: string, overrides: Partial<KpiGoalInput> = {}): KpiGoalInput {
  return {
    definitionId,
    ...COMPANY,
    condition: { kind: "at_least", target: "100" },
    period: PERIOD,
    pacing: "none",
    ...overrides,
  };
}
async function pipelineFixture() {
  const seeded = await seedPipeline(h);
  const stage = seeded.stages[0];
  if (!stage) throw new Error("Pipeline stage fixture missing");
  return { pipeline: seeded.pipeline, stage };
}
async function tableCount(
  table: "kpi_definitions" | "kpi_goals" | "kpi_schemes" | "kpi_measurements",
) {
  // The identifier is a local closed union; no request input reaches SQL text.
  const result = await h.db.execute(
    sql`SELECT count(*)::int AS count FROM ${sql.identifier(table)}`,
  );
  return (result.rows as { count: number }[])[0]?.count ?? 0;
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-05T16:00:00Z"));
  h = await makeTestDb();
  try {
    admin = toActor(await seedUser(h, { isAdmin: true }));
    request.db = h.db;
    request.actor = admin;
    request.headers.clear();
    request.cookies.clear();
    request.headers.set("sec-fetch-site", "same-origin");
    request.cookies.set("wd_csrf", CSRF);
  } catch (error) {
    await h.close();
    throw error;
  }
});
afterEach(async () => {
  request.db = null;
  request.actor = null;
  request.headers.clear();
  request.cookies.clear();
  await h.close();
  vi.useRealTimers();
});

describe("KPI native CRM evaluation", () => {
  it("discloses undated closed events under their ACL and leaves legitimately open or unscheduled records alone", async () => {
    const alice = toActor(await seedUser(h));
    const bob = await seedUser(h);
    const { pipeline, stage } = await pipelineFixture();
    for (const [title, status, ownerId, visibilityLevel] of [
      ["Undated visible loss", "lost", alice.id, "all"],
      ["Undated private loss", "lost", bob.id, "owner"],
      ["Legitimately open", "open", alice.id, "all"],
    ] as const)
      await seedDeal(h, {
        title,
        status,
        ownerId,
        visibilityLevel,
        pipelineId: pipeline.id,
        stageId: stage.id,
        lostTime: null,
      });
    const definition = await saveKpiDefinition(
      h.db,
      admin,
      { ...COUNT, filters: { pipelineId: pipeline.id, status: "lost" } },
      {},
    );
    const goal = await assignKpiGoal(
      h.db,
      admin,
      goalInput(definition.id, { condition: { kind: "at_most", target: "0" } }),
    );
    const result = await readKpiGoalResult(h.db, alice, goal, "2026-11-05", SIGNAL(), CLOCK);
    expect(result.measurement).toMatchObject({
      state: "incomplete",
      value: "0",
      recordCount: 0,
      excludedCount: 1,
    });
    expect(result.assessment.standing).toBe("unavailable");
    expect(result.measurement.contributors.map((row) => row.label)).toEqual([
      "Undated visible loss",
    ]);
    expect(result.measurement.contributors[0]).toMatchObject({
      observedOn: null,
      reason: "missing_measurement_date",
    });
    const type = await seedActivityType(h);
    await h.db.insert(schema.activities).values([
      {
        subject: "Undated completion",
        done: true,
        doneAt: null,
        typeId: type.id,
        ownerId: alice.id,
        assigneeId: alice.id,
      },
      {
        subject: "Not yet completed",
        done: false,
        doneAt: null,
        typeId: type.id,
        ownerId: alice.id,
        assigneeId: alice.id,
      },
    ]);
    const activityDefinition = {
      name: "Completions",
      description: "",
      source: "activities" as const,
      calculation: "count" as const,
      unit: "count" as const,
      dateField: "completed" as const,
      filters: { activityTypeId: type.id, status: "completed" as const },
    };
    const completed = await evaluateKpi(
      h.db,
      alice,
      activityDefinition,
      COMPANY,
      PERIOD,
      "2026-11-05",
      SIGNAL(),
      undefined,
      CLOCK,
    );
    expect(completed).toMatchObject({ state: "incomplete", value: "0", excludedCount: 1 });
    expect(completed.contributors.map((row) => row.label)).toEqual(["Undated completion"]);
    const unscheduled = await evaluateKpi(
      h.db,
      alice,
      {
        ...activityDefinition,
        dateField: "due",
        filters: { activityTypeId: type.id, status: "overdue" },
      },
      COMPANY,
      PERIOD,
      "2026-11-05",
      SIGNAL(),
      undefined,
      CLOCK,
    );
    expect(unscheduled).toMatchObject({ state: "available", value: "0", excludedCount: 0 });
  });
  it("honours actor-timezone month boundaries, currency, precision and contributing records", async () => {
    const { pipeline, stage } = await pipelineFixture();
    const values = [
      {
        title: "Berlin November starts",
        value: "0.1001",
        currency: "EUR",
        wonTime: new Date("2026-10-31T23:30:00Z"),
      },
      {
        title: "Second November",
        value: "0.2002",
        currency: "EUR",
        wonTime: new Date("2026-11-02T09:00:00Z"),
      },
      {
        title: "Berlin December",
        value: "900",
        currency: "EUR",
        wonTime: new Date("2026-11-30T23:30:00Z"),
      },
      {
        title: "Different currency",
        value: "800",
        currency: "USD",
        wonTime: new Date("2026-11-02T09:00:00Z"),
      },
    ];
    for (const value of values)
      await seedDeal(h, {
        ...value,
        status: "won",
        pipelineId: pipeline.id,
        stageId: stage.id,
        ownerId: admin.id,
        visibilityLevel: "all",
      });
    const result = await evaluateKpi(
      h.db,
      admin,
      { ...DEFINITION, filters: { status: "won", pipelineId: pipeline.id } },
      COMPANY,
      PERIOD,
      "2026-11-05",
      SIGNAL(),
      undefined,
      CLOCK,
    );
    expect(result.value).toBe("0.3003");
    expect(result.recordCount).toBe(2);
    expect(result.excludedCount).toBe(1);
    expect(result.contributors.map((r) => r.label)).not.toContain("Berlin December");
    expect(result.contributors.find((r) => r.label === "Different currency")).toMatchObject({
      included: false,
      value: null,
      reason: "different_currency",
    });
    expect(result.trend?.[0]).toEqual({ day: "2026-11-01", value: "0.1001" });
  });
  it("keeps company scope subordinate to deal and restricted-pipeline ACLs", async () => {
    const alice = toActor(await seedUser(h));
    const bob = await seedUser(h);
    const { pipeline, stage } = await pipelineFixture();
    for (const [title, visibilityLevel, value] of [
      ["Visible", "all", "10"],
      ["Owner private", "owner", "700"],
    ] as const)
      await seedDeal(h, {
        title,
        value,
        currency: "EUR",
        status: "won",
        wonTime: new Date("2026-11-03T12:00:00Z"),
        pipelineId: pipeline.id,
        stageId: stage.id,
        ownerId: bob.id,
        visibilityLevel,
      });
    const [group] = await h.db
      .insert(schema.visibilityGroups)
      .values({ name: randomUUID() })
      .returning();
    if (!group) throw new Error("Visibility fixture missing");
    const restricted = await pipelineFixture();
    await h.db
      .update(schema.pipelines)
      .set({ visibilityGroupId: group.id })
      .where(eq(schema.pipelines.id, restricted.pipeline.id));
    await seedDeal(h, {
      title: "Restricted pipeline",
      value: "900",
      currency: "EUR",
      status: "won",
      wonTime: new Date("2026-11-03T12:00:00Z"),
      pipelineId: restricted.pipeline.id,
      stageId: restricted.stage.id,
      ownerId: bob.id,
      visibilityLevel: "all",
    });
    const result = await evaluateKpi(
      h.db,
      alice,
      DEFINITION,
      COMPANY,
      PERIOD,
      "2026-11-05",
      SIGNAL(),
      undefined,
      CLOCK,
    );
    expect(result.value).toBe("10");
    expect(result.contributors.map((r) => r.label)).toEqual(["Visible"]);
    const unavailable = await evaluateKpi(
      h.db,
      alice,
      { ...DEFINITION, filters: { pipelineId: restricted.pipeline.id, status: "won" } },
      COMPANY,
      PERIOD,
      "2026-11-05",
      SIGNAL(),
      undefined,
      CLOCK,
    );
    expect(unavailable).toMatchObject({
      state: "unavailable",
      value: null,
      issues: expect.arrayContaining(["source_unavailable"]),
    });
  });
  it("calculates counts, distinct counts, ratios, averages and sales-cycle durations from real columns", async () => {
    const { pipeline, stage } = await pipelineFixture();
    for (const [status, value, days] of [
      ["won", "10", 2],
      ["won", "30", 6],
      ["lost", "80", 4],
    ] as const)
      await seedDeal(h, {
        title: `${status}-${value}`,
        status,
        value,
        currency: "EUR",
        createdAt: new Date(`2026-11-0${1}T12:00:00Z`),
        wonTime: status === "won" ? new Date(Date.UTC(2026, 10, 1 + days, 12)) : null,
        lostTime: status === "lost" ? new Date(Date.UTC(2026, 10, 1 + days, 12)) : null,
        pipelineId: pipeline.id,
        stageId: stage.id,
        ownerId: admin.id,
        visibilityLevel: "all",
      });
    const calculate = (definition: KpiDefinitionInput) =>
      evaluateKpi(
        h.db,
        admin,
        { ...definition, filters: { ...definition.filters, pipelineId: pipeline.id } },
        COMPANY,
        PERIOD,
        "2026-11-08",
        SIGNAL(),
        undefined,
        CLOCK,
      );
    expect((await calculate(COUNT)).value).toBe("2");
    expect((await calculate({ ...COUNT, calculation: "distinct_count" })).value).toBe("2");
    expect((await calculate({ ...DEFINITION, calculation: "average" })).value).toBe("20");
    expect(
      (
        await calculate({
          ...DEFINITION,
          calculation: "median",
          unit: "days",
          valueField: "sales_cycle",
        })
      ).value,
    ).toBe("4");
    expect(
      (
        await calculate({
          ...DEFINITION,
          calculation: "duration",
          unit: "hours",
          valueField: "sales_cycle",
        })
      ).value,
    ).toBe("96");
    const ratio = await calculate({
      ...COUNT,
      calculation: "percentage",
      unit: "percent",
      filters: {},
      numeratorStatus: "won",
      denominatorStatus: "closed",
    });
    expect(ratio).toMatchObject({ value: "66.6666", numerator: 2, denominator: 3 });
    const disjoint = await calculate({
      ...COUNT,
      calculation: "ratio",
      unit: "custom",
      customUnit: "wins per loss",
      filters: {},
      numeratorStatus: "won",
      denominatorStatus: "lost",
    });
    expect(disjoint).toMatchObject({
      state: "available",
      value: "2",
      numerator: 2,
      denominator: 1,
      recordCount: 3,
    });
    const empty = await calculate({
      ...COUNT,
      calculation: "ratio",
      unit: "custom",
      customUnit: "wins per loss",
      filters: {},
      numeratorStatus: "won",
      denominatorStatus: "open",
    });
    expect(empty).toMatchObject({ state: "unavailable", value: null, denominator: 0 });
  });
  it("distinguishes actual timed overdue from all-day civil dates and preserves parent visibility", async () => {
    const alice = toActor(await seedUser(h));
    const bob = await seedUser(h);
    const type = await seedActivityType(h);
    const { pipeline, stage } = await pipelineFixture();
    const hidden = await seedDeal(h, {
      title: "Private parent",
      pipelineId: pipeline.id,
      stageId: stage.id,
      ownerId: bob.id,
      visibilityLevel: "owner",
    });
    await h.db.insert(schema.activities).values([
      {
        subject: "Timed earlier today",
        typeId: type.id,
        ownerId: alice.id,
        assigneeId: alice.id,
        dueAt: new Date("2026-11-05T08:00:00Z"),
      },
      {
        subject: "Timed later today",
        typeId: type.id,
        ownerId: alice.id,
        assigneeId: alice.id,
        dueAt: new Date("2026-11-05T18:00:00Z"),
      },
      {
        subject: "Civil yesterday",
        typeId: type.id,
        ownerId: alice.id,
        assigneeId: alice.id,
        allDay: true,
        dueDate: "2026-11-04",
        dueAt: new Date("2026-11-04T00:00:00Z"),
      },
      {
        subject: "Civil today",
        typeId: type.id,
        ownerId: alice.id,
        assigneeId: alice.id,
        allDay: true,
        dueDate: "2026-11-05",
        dueAt: new Date("2026-11-05T00:00:00Z"),
      },
      {
        subject: "Hidden parent overdue",
        typeId: type.id,
        ownerId: bob.id,
        assigneeId: alice.id,
        dealId: hidden.id,
        dueAt: new Date("2026-11-04T08:00:00Z"),
      },
    ]);
    const definition: KpiDefinitionInput = {
      name: "Overdue",
      description: "",
      source: "activities",
      calculation: "count",
      unit: "count",
      dateField: "due",
      filters: { status: "overdue", activityTypeId: type.id },
    };
    const result = await evaluateKpi(
      h.db,
      alice,
      definition,
      COMPANY,
      PERIOD,
      "2026-11-05",
      SIGNAL(),
      undefined,
      CLOCK,
    );
    expect(result.value).toBe("2");
    expect(result.contributors.find((row) => row.label === "Timed earlier today")).toMatchObject({
      href: null,
      observedOn: "2026-11-05",
      statuses: ["open", "overdue"],
    });
    expect(result.contributors.map((r) => r.label)).not.toContain("Hidden parent overdue");
    expect(
      result.contributors
        .filter((r) => r.included)
        .map((r) => r.label)
        .sort(),
    ).toEqual(["Civil yesterday", "Timed earlier today"]);
  });
});

describe("KPI native durable revisions, transactions and observations", () => {
  it("labels only visible person and team assignments and resolves renamed scopes", async () => {
    const alice = toActor(await seedUser(h, { name: "Alice Visible" }));
    const bob = toActor(await seedUser(h, { name: "Bob Hidden" }));
    const [team] = await h.db.insert(schema.teams).values({ name: "Consulting" }).returning();
    if (team === undefined) throw new Error("Named team fixture missing");
    await h.db.insert(schema.teamMembers).values({ teamId: team.id, userId: alice.id });
    const definition = await saveKpiDefinition(h.db, admin, COUNT, {});
    const own = await assignKpiGoal(
      h.db,
      admin,
      goalInput(definition.id, { scope: "user", scopeId: alice.id }),
    );
    const hidden = await assignKpiGoal(
      h.db,
      admin,
      goalInput(definition.id, { scope: "user", scopeId: bob.id }),
    );
    const shared = await assignKpiGoal(
      h.db,
      admin,
      goalInput(definition.id, { scope: "team", scopeId: team.id }),
    );
    const workspace = await readKpiWorkspace(h.db, alice, "2026-11-05", SIGNAL());
    expect(workspace.goals.find((row) => row.goal.id === own.id)?.scopeName).toBe("Alice Visible");
    expect(workspace.goals.find((row) => row.goal.id === shared.id)?.scopeName).toBe("Consulting");
    expect(workspace.goals.some((row) => row.goal.id === hidden.id)).toBe(false);
    await expect(
      readKpiGoalResult(h.db, alice, hidden, "2026-11-05", SIGNAL()),
    ).rejects.toMatchObject({ id: "E_PERM_DENIED" });
    await h.db.update(schema.teams).set({ name: "Growth" }).where(eq(schema.teams.id, team.id));
    expect((await readKpiGoalResult(h.db, alice, shared, "2026-11-05", SIGNAL())).scopeName).toBe(
      "Growth",
    );
  });
  it("returns only exact assigned scorecard labels to a non-manager after a new revision", async () => {
    const alice = toActor(await seedUser(h));
    const bob = toActor(await seedUser(h));
    const definition = await saveKpiDefinition(h.db, admin, COUNT, {});
    const condition = { kind: "at_least" as const, target: "1" };
    const original = await saveKpiScheme(
      h.db,
      admin,
      {
        name: "Alice original scorecard",
        description: "",
        entries: [{ definitionId: definition.id, condition }],
      },
      {},
    );
    const privateScheme = await saveKpiScheme(
      h.db,
      admin,
      {
        name: "Bob private assignment",
        description: "",
        entries: [{ definitionId: definition.id, condition }],
      },
      {},
    );
    await assignKpiGoal(
      h.db,
      admin,
      goalInput(definition.id, {
        scope: "user",
        scopeId: alice.id,
        schemeId: original.id,
        condition,
      }),
    );
    await assignKpiGoal(
      h.db,
      admin,
      goalInput(definition.id, {
        scope: "user",
        scopeId: bob.id,
        schemeId: privateScheme.id,
        condition,
      }),
    );
    await saveKpiScheme(
      h.db,
      admin,
      {
        name: "Unassigned revised name",
        description: "",
        entries: [{ definitionId: definition.id, condition }],
      },
      { familyId: original.familyId, expectedRevision: 1 },
    );
    const aliceWorkspace = await readKpiWorkspace(h.db, alice, "2026-11-05", SIGNAL());
    expect(aliceWorkspace.schemes).toEqual([]);
    expect(aliceWorkspace.schemeLabels).toEqual([
      { id: original.id, name: "Alice original scorecard", revision: 1 },
    ]);
    const adminWorkspace = await readKpiWorkspace(h.db, admin, "2026-11-05", SIGNAL());
    expect(adminWorkspace.schemeLabels).toEqual(
      expect.arrayContaining([
        { id: original.id, name: "Alice original scorecard", revision: 1 },
        { id: privateScheme.id, name: "Bob private assignment", revision: 1 },
      ]),
    );
    expect(adminWorkspace.schemeLabels).toHaveLength(2);
  });
  it("pins old definitions and targets when a new library revision is published", async () => {
    const original = await saveKpiDefinition(h.db, admin, COUNT, {});
    const goal = await assignKpiGoal(
      h.db,
      admin,
      goalInput(original.id, { condition: { kind: "at_most", target: "0" } }),
    );
    const scheme = await saveKpiScheme(
      h.db,
      admin,
      {
        name: "Guardrails",
        description: "",
        entries: [{ definitionId: original.id, condition: { kind: "at_most", target: "0" } }],
      },
      {},
    );
    const next = success(
      await saveKpiDefinitionAction(
        {
          ...COUNT,
          name: "Changed label",
          filters: { status: "lost" },
          familyId: original.familyId,
          expectedRevision: 1,
        },
        CSRF,
      ),
    );
    expect(next.revision).toBe(2);
    expect((await getKpiDefinition(h.db, goal.definitionId)).name).toBe("Won deals");
    const workspace = await readKpiWorkspace(h.db, admin, "2026-11-05", SIGNAL());
    expect(workspace.definitions.find((d) => d.familyId === original.familyId)?.id).toBe(next.id);
    expect(workspace.referencedDefinitions?.find((d) => d.id === original.id)?.name).toBe(
      "Won deals",
    );
    expect(workspace.schemes.find((s) => s.id === scheme.id)?.entries[0]?.definitionId).toBe(
      original.id,
    );
    expect(workspace.goals.find((g) => g.goal.id === goal.id)?.goal.condition).toEqual({
      kind: "at_most",
      target: "0",
    });
  });
  it("admits only one concurrent publish from an expected family revision", async () => {
    const original = await saveKpiDefinition(h.db, admin, COUNT, {});
    const outcomes = await Promise.all([
      saveKpiDefinitionAction(
        { ...COUNT, name: "Revision A", familyId: original.familyId, expectedRevision: 1 },
        CSRF,
      ),
      saveKpiDefinitionAction(
        { ...COUNT, name: "Revision B", familyId: original.familyId, expectedRevision: 1 },
        CSRF,
      ),
    ]);
    expect(outcomes.filter((r) => r.ok)).toHaveLength(1);
    expect(outcomes.find((r) => !r.ok)).toMatchObject({
      ok: false,
      error: { id: "E_KPI_CONFLICT" },
    });
    expect(await tableCount("kpi_definitions")).toBe(2);
  });
  it("rolls back a whole scheme when a later entry is incompatible with the assigned period", async () => {
    const first = await saveKpiDefinition(h.db, admin, COUNT, {});
    const second = await saveKpiDefinition(h.db, admin, { ...COUNT, name: "Deadline" }, {});
    const scheme = await saveKpiScheme(
      h.db,
      admin,
      {
        name: "Atomic",
        description: "",
        entries: [
          { definitionId: first.id, condition: { kind: "at_least", target: "1" } },
          { definitionId: second.id, condition: { kind: "deadline", target: "2" } },
        ],
      },
      {},
    );
    const failed = await applyKpiSchemeAction(
      { ...COMPANY, schemeId: scheme.id, period: PERIOD, pacing: "none" },
      CSRF,
    );
    expect(failed).toMatchObject({ ok: false, error: { id: "E_KPI_INVALID" } });
    expect(await tableCount("kpi_goals")).toBe(0);
    const applied = success(
      await applyKpiSchemeAction(
        {
          ...COMPANY,
          schemeId: scheme.id,
          period: {
            kind: "one_off",
            interval: "monthly",
            startsOn: "2026-11-01",
            endsOn: "2026-11-30",
          },
          pacing: "none",
        },
        CSRF,
      ),
    );
    expect(applied).toHaveLength(2);
    expect(await tableCount("kpi_goals")).toBe(2);
  });
  it("rolls back definitions as well as scheme creation when a pack source reference is invalid", async () => {
    const failed = await createKpiPackAction(
      {
        name: "Atomic pack",
        description: "",
        entries: [
          { definition: COUNT, condition: { kind: "at_least", target: "1" } },
          {
            definition: { ...COUNT, filters: { pipelineId: randomUUID(), status: "won" } },
            condition: { kind: "at_least", target: "1" },
          },
        ],
      },
      CSRF,
    );
    expect(failed).toMatchObject({ ok: false, error: { id: "E_KPI_INVALID" } });
    expect(await tableCount("kpi_definitions")).toBe(0);
    expect(await tableCount("kpi_schemes")).toBe(0);
  });
  it("records signed percent margin and fractional rework with source notes, and rejects negative durations", async () => {
    const base: KpiDefinitionInput = {
      name: "Margin",
      description: "Explicitly measured",
      source: "manual",
      calculation: "average",
      unit: "percent",
      dateField: "measured",
      filters: {},
    };
    const margin = success(
      await createKpiGoalAction({ definition: base, assignment: goalInput(randomUUID()) }, CSRF),
    );
    const rework = success(
      await createKpiGoalAction(
        {
          definition: { ...base, name: "Rework", unit: "count" },
          assignment: goalInput(randomUUID(), { condition: { kind: "at_most", target: "1.5" } }),
        },
        CSRF,
      ),
    );
    const duration = success(
      await createKpiGoalAction(
        {
          definition: { ...base, name: "Response", unit: "hours" },
          assignment: goalInput(randomUUID()),
        },
        CSRF,
      ),
    );
    for (const [goal, value] of [
      [margin.goal, "-10.125"],
      [rework.goal, "1.5"],
    ] as const)
      success(
        await recordKpiMeasurementAction(
          {
            goalId: goal.id,
            value,
            measuredOn: "2026-11-03",
            sourceNote: "Approved measurement record",
            sampleSize: 2,
          },
          CSRF,
        ),
      );
    expect(
      await recordKpiMeasurementAction(
        {
          goalId: duration.goal.id,
          value: "-1",
          measuredOn: "2026-11-03",
          sourceNote: "Invalid negative duration",
        },
        CSRF,
      ),
    ).toMatchObject({ ok: false, error: { id: "E_KPI_INVALID" } });
    expect(
      (await readKpiGoalResult(h.db, admin, margin.goal, "2026-11-05", SIGNAL())).measurement,
    ).toMatchObject({ state: "available", value: "-10.125", sampleSize: 2 });
    expect(
      (await readKpiGoalResult(h.db, admin, rework.goal, "2026-11-05", SIGNAL())).measurement.value,
    ).toBe("1.5");
    const outsider = toActor(await seedUser(h));
    const personal = await assignKpiGoal(
      h.db,
      admin,
      goalInput(margin.definition.id, { scope: "user", scopeId: admin.id }),
    );
    request.actor = outsider;
    expect(await kpiScopeVisible(h.db, outsider, personal)).toBe(false);
    expect(
      await recordKpiMeasurementAction(
        {
          goalId: personal.id,
          value: "1",
          measuredOn: "2026-11-03",
          sourceNote: "No management grant",
        },
        CSRF,
      ),
    ).toMatchObject({ ok: false, error: { id: "E_PERM_DENIED" } });
    expect(await tableCount("kpi_measurements")).toBe(2);
  });
  it("checks real CSRF and permission gates before writes", async () => {
    expect(await saveKpiDefinitionAction(COUNT, null)).toMatchObject({
      ok: false,
      error: { id: "E_AUTH_CSRF" },
    });
    request.actor = toActor(await seedUser(h));
    expect(await saveKpiDefinitionAction(COUNT, CSRF)).toMatchObject({
      ok: false,
      error: { id: "E_PERM_DENIED" },
    });
    request.actor = null;
    expect(await saveKpiDefinitionAction(COUNT, CSRF)).toMatchObject({
      ok: false,
      error: { id: "E_AUTH_SESSION_DEAD" },
    });
    expect(await tableCount("kpi_definitions")).toBe(0);
  });
  it("enforces immutable definitions and pinned assignments at the database boundary", async () => {
    const definition = await saveKpiDefinition(h.db, admin, COUNT, {});
    const goal = await assignKpiGoal(h.db, admin, goalInput(definition.id));
    await expect(
      h.pool.query("UPDATE kpi_definitions SET revision=9 WHERE id=$1", [definition.id]),
    ).rejects.toThrow(/append-only/u);
    await expect(
      h.pool.query("DELETE FROM kpi_definitions WHERE id=$1", [definition.id]),
    ).rejects.toThrow(/append-only/u);
    await expect(
      h.pool.query("UPDATE kpi_goals SET assignment=$1::jsonb WHERE id=$2", [
        JSON.stringify({ ...goal, condition: { kind: "at_least", target: "999" } }),
        goal.id,
      ]),
    ).rejects.toThrow(/pin their definition/u);
    await h.db
      .update(schema.kpiGoals)
      .set({ archivedAt: new Date() })
      .where(eq(schema.kpiGoals.id, goal.id));
    const [row] = await h.db.select().from(schema.kpiGoals).where(eq(schema.kpiGoals.id, goal.id));
    expect(row?.assignment.condition.target).toBe("100");
    expect(row?.archivedAt).not.toBeNull();
  });
  it("captures a completed manual deadline at period end and preserves that viewer's snapshot", async () => {
    const created = success(
      await createKpiGoalAction(
        {
          definition: {
            name: "Deadline measure",
            description: "",
            source: "manual",
            calculation: "sum",
            unit: "count",
            dateField: "measured",
            filters: {},
          },
          assignment: goalInput(randomUUID(), {
            scope: "user",
            scopeId: admin.id,
            condition: { kind: "deadline", target: "2" },
            period: {
              kind: "one_off",
              interval: "monthly",
              startsOn: "2026-10-01",
              endsOn: "2026-10-03",
            },
          }),
        },
        CSRF,
      ),
    );
    success(
      await recordKpiMeasurementAction(
        {
          goalId: created.goal.id,
          value: "1",
          measuredOn: "2026-10-03",
          sourceNote: "First signed observation",
        },
        CSRF,
      ),
    );
    success(await closeKpiPeriodAction({ goalId: created.goal.id, on: "2026-10-01" }, CSRF));
    await h.db
      .update(schema.users)
      .set({ name: "Renamed snapshot owner" })
      .where(eq(schema.users.id, admin.id));
    success(
      await recordKpiMeasurementAction(
        {
          goalId: created.goal.id,
          value: "5",
          measuredOn: "2026-10-03",
          sourceNote: "Late additional observation",
        },
        CSRF,
      ),
    );
    const snapshot = await readKpiGoalResult(h.db, admin, created.goal, "2026-10-02", SIGNAL());
    expect(snapshot.measurement.value).toBe("1");
    expect(snapshot.scopeName).toBe("Renamed snapshot owner");
    expect(snapshot.assessment.standing).toBe("not_met");
    expect(snapshot.measurement.issues).toContain("frozen_viewer_snapshot");
    const other = toActor(await seedUser(h, { isAdmin: true }));
    expect(
      (await readKpiGoalResult(h.db, other, created.goal, "2026-10-03", SIGNAL())).measurement
        .value,
    ).toBe("6");
  });
});
