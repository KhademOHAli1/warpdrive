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
  "work_types",
  "work_stages",
  "work_items",
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

async function seedRetainedWorkProfile(h: TestDb, ownerId: string, dealId: string) {
  await h.db.insert(schema.companyProfiles).values({
    detailsCiphertext: "retained-company-details",
    detailsRevision: 3,
    detailsProvenance: {
      kind: "manual",
      confirmedAt: "2026-11-01T09:00:00.000Z",
      provider: null,
      checkedAt: null,
      checkedFields: [],
      verification: "self_reported",
    },
    branding: { iconAssetId: null, logoAssetId: null, accentColor: "#25466E", fit: "contain" },
    brandingRevision: 2,
  });
  await h.db.insert(schema.workspaceWorkProfiles).values({
    revision: 3,
    preferences: {
      workTypes: ["it_consulting"],
      primaryWorkType: "it_consulting",
      modules: ["sales", "work"],
      primaryGoal: "Deliver retained consulting projects",
      deliveryModels: ["Fixed scope"],
      customerTypes: ["Business"],
    },
  });
  const [type] = await h.db
    .insert(schema.workTypes)
    .values({
      key: "consulting_delivery",
      name: "Retained consulting delivery",
      kind: "it_consulting",
      fields: [
        { key: "hours", label: "Planned hours", type: "number", options: [], required: true },
      ],
    })
    .returning();
  if (type === undefined) throw new Error("Work type fixture missing");
  const [stage] = await h.db
    .insert(schema.workStages)
    .values({
      typeId: type.id,
      key: "planned",
      name: "Planned",
      bucket: "open",
      order: 0,
    })
    .returning();
  if (stage === undefined) throw new Error("Work stage fixture missing");
  await h.db.insert(schema.workItems).values({
    typeId: type.id,
    stageId: stage.id,
    title: "Retained work linked to CRM",
    ownerId,
    dealId,
    dueDate: "2026-11-12",
    visibility: "owner",
    values: { hours: 12.5 },
  });
}

it("upgrades populated 0106 to 0107, preserving CRM, Goals and Company Work data across reruns", async () => {
  const prefix = 107;
  const h = await freshMigrationDb();
  let target: Awaited<ReturnType<typeof migrationFolder>> | undefined;
  try {
    await installPrefix(h, prefix);
    target = await migrationFolder(prefix + 1);
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
    // Seed only columns present at0106; the current model also includes later Calendar fields.
    await h.pool.query(
      `INSERT INTO activities
        (type_id, subject, owner_id, assignee_id, deal_id, all_day, due_date, due_at, done)
       VALUES ($1,$2,$3,$3,$4,true,'2026-11-01','2026-11-01T00:00:00Z',false)`,
      [type.id, "Retained civil date", owner.id, deal.id],
    );
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
    await seedRetainedWorkProfile(h, owner.id, deal.id);
    const before = await retainedRows(h);
    const oldLedger = await ledger(h);
    expect(oldLedger).toHaveLength(prefix);
    expect(
      (await h.pool.query("SELECT to_regclass('public.kpi_definitions') AS value")).rows,
    ).toEqual([{ value: null }]);
    expect(await applyMigrations(h.db, AbortSignal.timeout(30000), target.folder)).toEqual({
      ok: true,
      value: { applied: true },
    });
    expect(await retainedRows(h)).toEqual(before);
    const admittedLedger = await ledger(h);
    expect(admittedLedger).toHaveLength(prefix + 1);
    expect(admittedLedger.slice(0, prefix)).toEqual(oldLedger);
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
