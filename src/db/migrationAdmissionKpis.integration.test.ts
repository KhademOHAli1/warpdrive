import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import * as schema from "@/db/schema";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import { assignKpiGoal, saveKpiDefinition } from "@/features/goals/kpiRepo";
import { toActor } from "@/features/stats/statsTestHelpers";
import type { TestDb } from "@/test/db";
import { applyMigrations } from "./migrate";
import {
  freshMigrationDb,
  installPrefix,
  ledger,
  migrationFolder,
} from "./migrationAdmission.test-helpers";

const retainedTables = [
  "users",
  "pipelines",
  "stages",
  "deals",
  "activity_types",
  "activities",
  "teams",
  "team_members",
  "goals",
  "user_preferences",
  "company_profiles",
  "workspace_work_profiles",
] as const;
async function retainedRows(h: TestDb): Promise<Record<string, string>> {
  const snapshot: Record<string, string> = {};
  for (const table of retainedTables) {
    // Closed local identifiers; exact JSON text retains numeric scale and timestamp precision.
    const result = await h.pool.query<{ value: string }>(
      `SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb)::text AS value FROM public."${table}" t`,
    );
    snapshot[table] = result.rows[0]?.value ?? "[]";
  }
  return snapshot;
}

it("upgrades the populated 0106 company prefix to 0107, preserves CRM/company data and admits an unchanged rerun", async () => {
  const h = await freshMigrationDb();
  let target: Awaited<ReturnType<typeof migrationFolder>> | undefined;
  try {
    // Ordinals are zero based: completed 0106 has 107 journal entries; 0107 is entry108.
    await installPrefix(h, 107);
    target = await migrationFolder(108);
    const owner = await seedUser(h.db, { isAdmin: true });
    const { pipeline, stages } = await seedPipelineWithStages(h.db, ["Retained stage"]);
    const stage = stages[0];
    if (!stage) throw new Error("Migration stage fixture missing");
    const [deal] = await h.db
      .insert(schema.deals)
      .values({
        title: "Retained precise won value",
        value: "99999999999999.1234",
        currency: "IRR",
        pipelineId: pipeline.id,
        stageId: stage.id,
        ownerId: owner.id,
        visibilityLevel: "owner",
        status: "won",
        wonTime: new Date("2026-10-31T23:30:00Z"),
      })
      .returning();
    const [type] = await h.db
      .insert(schema.activityTypes)
      .values({ key: randomUUID(), name: "Retained type" })
      .returning();
    const [team] = await h.db.insert(schema.teams).values({ name: randomUUID() }).returning();
    if (!deal || !type || !team) throw new Error("Populated upgrade fixture missing");
    await h.db.insert(schema.teamMembers).values({ teamId: team.id, userId: owner.id });
    await h.db.insert(schema.activities).values({
      typeId: type.id,
      subject: "Retained civil date",
      ownerId: owner.id,
      assigneeId: owner.id,
      dealId: deal.id,
      allDay: true,
      dueDate: "2026-11-01",
      dueAt: new Date("2026-11-01T00:00:00Z"),
      done: false,
    });
    await h.db.insert(schema.goals).values({
      subject: "deal",
      action: "lost",
      metric: "count",
      assigneeKind: "team",
      assigneeId: team.id,
      pipelineId: pipeline.id,
      interval: "monthly",
      target: "0",
      currency: "EUR",
      startsOn: "2026-11-01",
    });
    await h.db.insert(schema.userPreferences).values({
      userId: owner.id,
      timezone: "Europe/Berlin",
      density: "compact",
      ui: {
        localePreferences: {
          locale: "fa",
          calendar: "persian",
          timeZone: "Europe/Berlin",
          numberingSystem: "latn",
        },
      },
    });
    await h.pool.query(
      `INSERT INTO company_profiles (id, details_ciphertext, details_revision, details_provenance)
       VALUES (true, 'retained-company-details', 3, '{"source":"migration-admission"}'::jsonb)`,
    );
    await h.pool.query(
      `INSERT INTO workspace_work_profiles (id, revision, preferences)
       VALUES (true, 3, '{"workTypes":["custom"],"primaryWorkType":"custom","modules":[],"primaryGoal":"retained","deliveryModels":[],"customerTypes":[]}'::jsonb)`,
    );
    const before = await retainedRows(h);
    const oldLedger = await ledger(h);
    expect(oldLedger).toHaveLength(107);
    expect(
      (await h.pool.query("SELECT to_regclass('public.kpi_definitions') AS value")).rows,
    ).toEqual([{ value: null }]);
    expect(await applyMigrations(h.db, AbortSignal.timeout(30000), target.folder)).toEqual({
      ok: true,
      value: { applied: true },
    });
    expect(await retainedRows(h)).toEqual(before);
    const admittedLedger = await ledger(h);
    expect(admittedLedger).toHaveLength(108);
    expect(admittedLedger.slice(0, 107)).toEqual(oldLedger);
    const names = (
      await h.pool.query<{ table_name: string }>(
        "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('kpi_definitions','kpi_schemes','kpi_goals','kpi_measurements','kpi_snapshots') ORDER BY table_name",
      )
    ).rows.map((r) => r.table_name);
    expect(names).toEqual([
      "kpi_definitions",
      "kpi_goals",
      "kpi_measurements",
      "kpi_schemes",
      "kpi_snapshots",
    ]);
    const triggers = (
      await h.pool.query<{ tgname: string; tgenabled: string }>(
        "SELECT tgname,tgenabled FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE 'kpi_%' ORDER BY tgname",
      )
    ).rows;
    expect(triggers.map((t) => t.tgname)).toEqual([
      "kpi_definition_immutable",
      "kpi_goal_pinned",
      "kpi_measurement_immutable",
      "kpi_scheme_immutable",
      "kpi_snapshot_immutable",
    ]);
    expect(triggers.every((t) => t.tgenabled === "O")).toBe(true);
    const definition = await saveKpiDefinition(
      h.db,
      toActor(owner),
      {
        name: "New guardrail",
        description: "",
        source: "deals",
        calculation: "count",
        unit: "count",
        dateField: "closed",
        filters: { status: "lost" },
      },
      {},
    );
    const assignment = await assignKpiGoal(h.db, toActor(owner), {
      definitionId: definition.id,
      scope: "company",
      scopeId: null,
      condition: { kind: "at_most", target: "0" },
      period: { kind: "calendar", interval: "monthly", startsOn: "2026-11-01" },
      pacing: "none",
    });
    expect(assignment.definitionId).toBe(definition.id);
    await expect(
      h.pool.query("UPDATE kpi_definitions SET definition='{}'::jsonb WHERE id=$1", [
        definition.id,
      ]),
    ).rejects.toThrow(/append-only/u);
    await expect(
      h.pool.query("UPDATE kpi_goals SET assignment='{}'::jsonb WHERE id=$1", [assignment.id]),
    ).rejects.toThrow(/pin their definition/u);
    expect(await applyMigrations(h.db, AbortSignal.timeout(30000), target.folder)).toEqual({
      ok: true,
      value: { applied: true },
    });
    expect(await ledger(h)).toEqual(admittedLedger);
    expect(await retainedRows(h)).toEqual(before);
  } finally {
    try {
      await target?.dispose();
    } finally {
      await h.close();
    }
  }
});
