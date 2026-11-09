import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import {
  removeSavedFilter,
  toggleFavorite,
  updateSavedFilter,
} from "@/features/saved-filters/savedFilterActions";
import { makeTestDb, type TestDb } from "@/test/db";
import {
  createSavedPerformanceReport,
  listSavedPerformanceReports,
  loadSavedPerformanceReport,
  MAX_SAVED_PERFORMANCE_REPORTS,
  removeSavedPerformanceReport,
  SAVED_PERFORMANCE_REPORT_TARGET,
  type SavedPerformanceReportPrincipal,
  savedPerformanceDefinition,
} from "./savedPerformanceReports";

const signal = () => AbortSignal.timeout(10_000);
const definition = {
  version: 1,
  from: "2026-01-01",
  to: "2026-03-31",
  currency: "EUR",
  pipelineId: null,
  ownerScope: { kind: "me" },
} as const;
const notFound = { state: "unavailable", reason: "not-found" };
const deniedScope = { state: "unavailable", reason: "scope-unavailable" };

async function principal(
  h: TestDb,
  canViewOthers = false,
): Promise<SavedPerformanceReportPrincipal> {
  const userId = randomUUID();
  const sessionId = randomUUID();
  const permissionSetId = randomUUID();
  await h.pool.query("INSERT INTO permission_sets(id,name,flags) VALUES($1,$2,$3::jsonb)", [
    permissionSetId,
    `report-fixture-${permissionSetId}`,
    JSON.stringify({ "stats.viewOthers": canViewOthers }),
  ]);
  await h.pool.query(
    "INSERT INTO users(id,email,name,permission_set_id) VALUES($1,$2,'Report fixture',$3)",
    [userId, `${userId}@example.test`, permissionSetId],
  );
  await h.pool.query(
    `INSERT INTO sessions(id,token_hash,user_id,expires_at,auth_method,assurance) VALUES(
      $1,$2,$3,pg_catalog.clock_timestamp() + interval '1 hour','legacy','legacy'
    )`,
    [sessionId, `fixture-session-${sessionId}`, userId],
  );
  return {
    session: { userId, sessionId },
    actor: {
      id: userId,
      type: "regular",
      isActive: true,
      groupIds: new Set(),
      flags: canViewOthers ? new Set(["stats.viewOthers"]) : new Set(),
    },
  };
}

async function withReportDb(run: (h: TestDb) => Promise<void>) {
  const h = await makeTestDb();
  try {
    await run(h);
  } finally {
    await h.close();
  }
}

async function save(
  h: TestDb,
  owner: SavedPerformanceReportPrincipal,
  report: unknown = definition,
) {
  const result = await createSavedPerformanceReport(
    h.db,
    owner,
    { name: "Quarterly performance", definition: report },
    signal(),
  );
  if (result.state !== "created") throw new Error("Expected a saved report");
  return result.id;
}

describe("private saved Performance reports", () => {
  test("requires explicit fixed scope and rejects unrecognized or unbounded fields", () => {
    expect(savedPerformanceDefinition.safeParse(definition).success).toBe(true);
    for (const raw of [
      { ...definition, version: 2 },
      { ...definition, currency: "ZZZ" },
      { ...definition, pipelineId: undefined },
      { ...definition, ownerScope: undefined },
      { ...definition, ownerScope: { kind: "me", teamId: randomUUID() } },
      { ...definition, from: "2026-03-32" },
      { ...definition, from: "2026-04-01" },
      { ...definition, to: "2030-01-01" },
      { ...definition, timeZoneIdentity: "Europe/Berlin" },
      { ...definition, results: [] },
      { ...definition, credentials: "unrecognized" },
    ]) {
      expect(savedPerformanceDefinition.safeParse(raw).success).toBe(false);
    }
  });

  test("creates, lists, loads and removes only the authenticated owner's private target", async () => {
    await withReportDb(async (h) => {
      const owner = await principal(h);
      const other = await principal(h);
      const id = await save(h, owner);
      const report = { id, name: "Quarterly performance", definitionState: "version-1" };
      expect(await listSavedPerformanceReports(h.db, owner, signal())).toEqual({
        state: "listed",
        reports: [report],
        truncated: false,
      });
      expect(await loadSavedPerformanceReport(h.db, owner, id, signal())).toEqual({
        state: "loaded",
        report,
        definition,
      });
      expect(await listSavedPerformanceReports(h.db, other, signal())).toEqual({
        state: "listed",
        reports: [],
        truncated: false,
      });
      expect(await loadSavedPerformanceReport(h.db, other, id, signal())).toEqual(notFound);
      expect(await removeSavedPerformanceReport(h.db, other, id, signal())).toEqual(notFound);
      expect(await removeSavedPerformanceReport(h.db, owner, id, signal())).toEqual({
        state: "removed",
      });
      expect(await loadSavedPerformanceReport(h.db, owner, id, signal())).toEqual(notFound);
    });
  });

  test("rechecks owner capability, named pipeline availability and the authenticated session", async () => {
    await withReportDb(async (h) => {
      const owner = await principal(h, true);
      const pipelineId = randomUUID();
      await h.pool.query(
        "INSERT INTO pipelines(id,name,\"order\") VALUES($1,'Report pipeline',0)",
        [pipelineId],
      );
      const named = await save(h, owner, { ...definition, pipelineId });
      const acrossOwners = await save(h, owner, { ...definition, ownerScope: { kind: "all" } });
      await h.pool.query("UPDATE pipelines SET is_archived=true WHERE id=$1", [pipelineId]);
      await h.pool.query("UPDATE users SET permission_set_id=NULL WHERE id=$1", [owner.actor.id]);
      expect(await loadSavedPerformanceReport(h.db, owner, named, signal())).toEqual(deniedScope);
      expect(await loadSavedPerformanceReport(h.db, owner, acrossOwners, signal())).toEqual(
        deniedScope,
      );
      expect(
        await createSavedPerformanceReport(
          h.db,
          owner,
          {
            name: "Revoked scope",
            definition: { ...definition, ownerScope: { kind: "all" } },
          },
          signal(),
        ),
      ).toEqual(deniedScope);
      await h.pool.query(
        "UPDATE sessions SET revoked_at=pg_catalog.clock_timestamp() WHERE id=$1",
        [owner.session.sessionId],
      );
      expect(await listSavedPerformanceReports(h.db, owner, signal())).toEqual({
        state: "unavailable",
        reason: "authentication-required",
      });
    });
  });

  test("preserves unsupported rows for private removal and keeps generic owner mutations separate", async () => {
    await withReportDb(async (h) => {
      const owner = await principal(h);
      const id = randomUUID();
      const legacyId = randomUUID();
      await h.pool.query(
        `INSERT INTO saved_filters(id,name,target_entity,definition,owner_id,is_shared)
        VALUES($1,'Future report',$2,'{"version":2,"privateResult":"opaque"}',$4,false),
          ($3,'Ordinary view','deal','{}',$4,false),
          (pg_catalog.gen_random_uuid(),'Misclassified shared row',$2,'{"version":2}',$4,true)`,
        [id, SAVED_PERFORMANCE_REPORT_TARGET, legacyId, owner.actor.id],
      );
      expect(await listSavedPerformanceReports(h.db, owner, signal())).toEqual({
        state: "listed",
        reports: [{ id, name: "Future report", definitionState: "unsupported-version" }],
        truncated: false,
      });
      expect(await loadSavedPerformanceReport(h.db, owner, id, signal())).toEqual({
        state: "unavailable",
        reason: "unsupported-version",
      });
      const generic = { userId: owner.actor.id, isAdmin: true, flags: {} };
      expect(
        await updateSavedFilter(h.db, generic, id, { isShared: true }, signal()),
      ).toMatchObject({ ok: false });
      expect(await toggleFavorite(h.db, generic, id, signal())).toMatchObject({ ok: false });
      expect(await removeSavedFilter(h.db, generic, id, signal())).toMatchObject({ ok: false });
      expect(await removeSavedPerformanceReport(h.db, owner, legacyId, signal())).toEqual(notFound);
      expect(await removeSavedFilter(h.db, generic, legacyId, signal())).toMatchObject({
        ok: true,
      });
      expect(await removeSavedPerformanceReport(h.db, owner, id, signal())).toEqual({
        state: "removed",
      });
    });
  });

  test("rolls back when authority expires during a write and withholds native error detail", async () => {
    await withReportDb(async (h) => {
      const owner = await principal(h);
      const existing = await save(h, owner);
      await h.pool.query(`
        CREATE FUNCTION public.fixture_saved_authority_change() RETURNS trigger
        LANGUAGE plpgsql AS $body$
        BEGIN
          IF TG_OP = 'INSERT' THEN
            IF NEW.name = 'Private report marker' THEN
              RAISE EXCEPTION 'fixture write failure %', NEW.name;
            END IF;
            UPDATE public.sessions SET expires_at = pg_catalog.clock_timestamp()
            WHERE user_id = NEW.owner_id;
          ELSE
            UPDATE public.sessions SET expires_at = pg_catalog.clock_timestamp()
            WHERE user_id = OLD.owner_id;
          END IF;
          RETURN NULL;
        END;
        $body$;
        CREATE TRIGGER fixture_saved_authority_change
        AFTER INSERT OR DELETE ON public.saved_filters
        FOR EACH ROW EXECUTE FUNCTION public.fixture_saved_authority_change();
      `);
      const expired = { state: "unavailable", reason: "authentication-required" };
      expect(
        await createSavedPerformanceReport(
          h.db,
          owner,
          { name: "Expired on insert", definition },
          signal(),
        ),
      ).toEqual(expired);
      expect(await removeSavedPerformanceReport(h.db, owner, existing, signal())).toEqual(expired);
      expect(
        await createSavedPerformanceReport(
          h.db,
          owner,
          { name: "Private report marker", definition },
          signal(),
        ),
      ).toEqual({ state: "unavailable", reason: "source-unavailable" });
      expect(await listSavedPerformanceReports(h.db, owner, signal())).toMatchObject({
        state: "listed",
        reports: [{ id: existing }],
      });
    });
  });

  test("serializes the owner cap across concurrent creates", async () => {
    await withReportDb(async (h) => {
      const owner = await principal(h);
      await h.pool.query(
        `INSERT INTO saved_filters(name,target_entity,definition,owner_id)
        SELECT 'Existing report ' || n, $1, $2::jsonb, $3::uuid
        FROM pg_catalog.generate_series(1,$4::integer) n`,
        [
          SAVED_PERFORMANCE_REPORT_TARGET,
          JSON.stringify(definition),
          owner.actor.id,
          MAX_SAVED_PERFORMANCE_REPORTS - 1,
        ],
      );
      const results = await Promise.all(
        ["One", "Two"].map((name) =>
          createSavedPerformanceReport(h.db, owner, { name, definition }, signal()),
        ),
      );
      expect(results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ state: "created" }),
          { state: "unavailable", reason: "report-limit" },
        ]),
      );
      const result = await listSavedPerformanceReports(h.db, owner, signal());
      if (result.state !== "listed") throw new Error("Expected a bounded report list");
      expect(result.reports).toHaveLength(MAX_SAVED_PERFORMANCE_REPORTS);
      expect(result.truncated).toBe(false);
    });
  });
});
