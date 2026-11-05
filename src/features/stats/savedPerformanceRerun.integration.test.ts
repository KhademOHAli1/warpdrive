import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import { hydrateActor } from "@/server/hydrateActor";
import { createCaller } from "@/server/trpc/root";
import { makeTestDb, type TestDb } from "@/test/db";
import {
  createSavedPerformanceReport,
  type SavedPerformanceDefinition,
  type SavedPerformanceReportPrincipal,
} from "./savedPerformanceReports";

const signal = () => AbortSignal.timeout(15_000);

async function withReportDb(run: (h: TestDb) => Promise<void>) {
  const h = await makeTestDb();
  try {
    await run(h);
  } finally {
    await h.close();
  }
}

async function serverPrincipal(h: TestDb, viewOthers = false) {
  const user = await seedUser(h.db, { isAdmin: false });
  const sessionId = randomUUID();
  await h.pool.query(
    `INSERT INTO sessions(id,token_hash,user_id,expires_at,auth_method,assurance)
    VALUES($1,$2,$3,pg_catalog.clock_timestamp() + interval '1 hour','legacy','legacy')`,
    [sessionId, `saved-rerun-${sessionId}`, user.id],
  );
  if (viewOthers) {
    const permission = randomUUID();
    await h.pool.query(
      "INSERT INTO permission_sets(id,name,flags) VALUES($1,$2,'{\"stats.viewOthers\":true}'::jsonb)",
      [permission, `saved-rerun-${permission}`],
    );
    await h.pool.query("UPDATE users SET permission_set_id=$1 WHERE id=$2", [permission, user.id]);
  }
  const actor = await hydrateActor(h.db, user.id, signal());
  if (actor === null) throw new Error("Expected an active fixture actor");
  return { session: { userId: user.id, sessionId }, actor };
}

async function save(
  h: TestDb,
  principal: SavedPerformanceReportPrincipal,
  definition: SavedPerformanceDefinition,
) {
  const result = await createSavedPerformanceReport(
    h.db,
    principal,
    { name: "Exact Performance", definition },
    signal(),
  );
  if (result.state !== "created") throw new Error("Expected a saved fixture report");
  return result.id;
}

const period = {
  version: 1,
  from: "2026-01-01",
  to: "2026-03-31",
  currency: "EUR",
} as const;

test("reruns the same dashboard calculations and retains the exact saved self-user selector", async () => {
  await withReportDb(async (h) => {
    const principal = await serverPrincipal(h);
    const { pipeline, stages } = await seedPipelineWithStages(h.db, ["Qualified"]);
    const stage = stages[0];
    if (stage === undefined) throw new Error("Expected a fixture stage");
    await h.pool.query(
      `INSERT INTO deals(title,pipeline_id,stage_id,owner_id,visibility_level,status,currency,value,created_at,won_time)
      VALUES('Included',$1,$2,$3,'owner','won','EUR','123.4567','2026-01-10T09:00:00Z','2026-02-10T09:00:00Z'),
        ('Different currency',$1,$2,$3,'owner','won','USD','789.1234','2026-01-10T09:00:00Z','2026-02-10T09:00:00Z')`,
      [pipeline.id, stage.id, principal.actor.id],
    );
    const definition = {
      ...period,
      pipelineId: pipeline.id,
      ownerScope: { kind: "user", userId: principal.actor.id },
    } as const;
    const id = await save(h, principal, definition);
    const caller = createCaller({ db: h.db, ...principal });
    const adHoc = await caller.stats.dashboard({
      currency: "EUR",
      pipelineId: pipeline.id,
      ownerScope: definition.ownerScope,
      from: period.from,
      to: period.to,
    });
    expect(adHoc.dealPerformance.won).toEqual({ count: 1, value: "123.4567" });
    expect(adHoc.effectiveOwnerScope).toEqual({ kind: "me" });
    expect(await caller.stats.savedPerformanceRerun({ id })).toEqual({
      state: "available",
      report: { id, name: "Exact Performance", definitionState: "version-1" },
      definition,
      dashboard: { ...adHoc, effectiveOwnerScope: definition.ownerScope },
    });
    const other = await serverPrincipal(h);
    expect(await createCaller({ db: h.db, ...other }).stats.savedPerformanceRerun({ id })).toEqual({
      state: "unavailable",
      reason: "not-found",
    });
  });
});

test("refuses lost owner capability, an archived pipeline, an unknown definition, and a revoked session", async () => {
  await withReportDb(async (h) => {
    const principal = await serverPrincipal(h, true);
    const { pipeline } = await seedPipelineWithStages(h.db, ["Qualified"]);
    const scoped = { ...period, pipelineId: pipeline.id, ownerScope: { kind: "me" } } as const;
    const selected = await save(h, principal, scoped);
    const broad = await save(h, principal, {
      ...scoped,
      pipelineId: null,
      ownerScope: { kind: "all" },
    });
    const future = await save(h, principal, scoped);
    const caller = createCaller({ db: h.db, ...principal });
    await h.pool.query("UPDATE users SET permission_set_id=NULL WHERE id=$1", [principal.actor.id]);
    expect(await caller.stats.savedPerformanceRerun({ id: broad })).toEqual({
      state: "unavailable",
      reason: "scope-unavailable",
    });
    await h.pool.query("UPDATE pipelines SET is_archived=true WHERE id=$1", [pipeline.id]);
    expect(await caller.stats.savedPerformanceRerun({ id: selected })).toEqual({
      state: "unavailable",
      reason: "scope-unavailable",
    });
    await h.pool.query("UPDATE saved_filters SET definition='{\"version\":2}'::jsonb WHERE id=$1", [
      future,
    ]);
    expect(await caller.stats.savedPerformanceRerun({ id: future })).toEqual({
      state: "unavailable",
      reason: "unsupported-version",
    });
    await h.pool.query("UPDATE sessions SET revoked_at=pg_catalog.clock_timestamp() WHERE id=$1", [
      principal.session.sessionId,
    ]);
    expect(await caller.stats.savedPerformanceRerun({ id: selected })).toEqual({
      state: "unavailable",
      reason: "authentication-required",
    });
  });
});
