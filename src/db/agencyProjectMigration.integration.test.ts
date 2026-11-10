import { randomUUID } from "node:crypto";
import { assert, expect, test } from "vitest";
import { createNativeProjectRepository } from "@/features/agency-projects/nativeProject";
import { enableNativeProjects } from "@/features/agency-projects/nativeViews";
import type { TestDb } from "@/test/db";
import { applyMigrations } from "./migrate";
import {
  canonicalFolder,
  freshMigrationDb,
  installPrefix,
  ledger,
} from "./migrationAdmission.test-helpers";
import { readCanonicalMigrations } from "./migrationAdmissionSource";
import { seedPipelineWithStages, seedUser } from "./testing/factories";

async function businessSnapshot(h: TestDb) {
  return Promise.all(
    [
      "users",
      "auth_users",
      "user_preferences",
      "sessions",
      "organizations",
      "persons",
      "deals",
      "privacy_cases",
      "workflow_v2_record_events",
    ].map(
      async (table) =>
        (
          await h.pool.query(
            `SELECT to_jsonb(r) AS value FROM ${table} r ORDER BY to_jsonb(r)::text`,
          )
        ).rows,
    ),
  );
}

test("fresh canonical admission creates the disabled module and admits an unchanged rerun", async () => {
  const h = await freshMigrationDb();
  const signal = AbortSignal.timeout(30_000);
  try {
    expect(await applyMigrations(h.db, signal)).toEqual({ ok: true, value: { applied: true } });
    const before = await ledger(h);
    await h.pool.query("INSERT INTO agency_project_settings(id) VALUES(true)");
    expect((await h.pool.query("SELECT enabled FROM agency_project_settings")).rows).toEqual([
      { enabled: false },
    ]);
    expect(await applyMigrations(h.db, signal)).toMatchObject({ ok: true });
    expect(await ledger(h)).toEqual(before);
  } finally {
    await h.close();
  }
});

test("canonical 0112 upgrades populated 0111 without changing CRM, identity, privacy or automation rows", async () => {
  const h = await freshMigrationDb();
  const signal = AbortSignal.timeout(30_000);
  try {
    await installPrefix(h, 112);
    expect(
      (await h.pool.query("SELECT to_regclass('public.agency_projects') AS value")).rows,
    ).toEqual([{ value: null }]);
    const owner = await seedUser(h.db, { isAdmin: true });
    const { pipeline, stages } = await seedPipelineWithStages(h.db, ["Upgrade stage"]);
    const open = stages[0];
    assert(open !== undefined);
    const orgId = randomUUID();
    const personId = randomUUID();
    const dealId = randomUUID();
    await h.pool.query(
      "INSERT INTO auth_users(id,email,name,email_verified) VALUES($1,$2,$3,true)",
      [owner.id, owner.email, owner.name],
    );
    await h.pool.query(
      'INSERT INTO user_preferences(user_id,density,ui) VALUES($1,\'compact\',\'{"localePreferences":{"locale":"fa","timeZone":"Europe/Berlin"}}\')',
      [owner.id],
    );
    await h.pool.query(
      "INSERT INTO organizations(id,name,owner_id,visibility_level) VALUES($1,'Preserved upgrade client',$2,'all')",
      [orgId, owner.id],
    );
    await h.pool.query(
      "INSERT INTO persons(id,name,owner_id,org_id,visibility_level) VALUES($1,'Preserved person',$2,$3,'all')",
      [personId, owner.id, orgId],
    );
    await h.pool.query(
      "INSERT INTO deals(id,title,owner_id,pipeline_id,stage_id,org_id,person_id,status,value,currency,won_time,visibility_level) VALUES($1,'Preserved won deal',$2,$3,$4,$5,$6,'won','48750.25','EUR','2025-05-17T10:11:12.345Z','all')",
      [dealId, owner.id, pipeline.id, open.id, orgId, personId],
    );
    await h.pool.query(
      "INSERT INTO privacy_cases(kind,created_by,intake_key,intake_digest,metadata_enc) VALUES('access',$1,'agency-upgrade-fixture','synthetic-digest',decode('00ff81','hex'))",
      [owner.id],
    );
    const sessionId = randomUUID();
    await h.pool.query(
      "INSERT INTO sessions(id,user_id,token_hash,expires_at,auth_method,assurance) VALUES($1,$2,$3,clock_timestamp()+interval '60 seconds','legacy','legacy')",
      [sessionId, owner.id, randomUUID()],
    );
    const before = await businessSnapshot(h);
    const beforeLedger = await ledger(h);
    expect(await applyMigrations(h.db, signal)).toEqual({ ok: true, value: { applied: true } });
    expect(await businessSnapshot(h)).toEqual(before);
    expect((await ledger(h)).slice(0, beforeLedger.length)).toEqual(beforeLedger);
    const canonical = await readCanonicalMigrations(canonicalFolder, signal);
    assert(canonical.ok);
    expect(await ledger(h)).toHaveLength(canonical.value.length);
    expect(
      (
        await h.pool.query(
          "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'agency_%' ORDER BY tablename",
        )
      ).rows,
    ).toEqual(
      [
        "agency_project_history",
        "agency_project_members",
        "agency_project_requests",
        "agency_project_settings",
        "agency_projects",
      ].map((tablename) => ({ tablename })),
    );
    await h.pool.query("INSERT INTO agency_project_settings(id) VALUES(true)");
    expect((await h.pool.query("SELECT enabled FROM agency_project_settings")).rows).toEqual([
      { enabled: false },
    ]);
    const who = { userId: owner.id, sessionId };
    const repository = createNativeProjectRepository(h.db, who);
    const input = {
      intentId: randomUUID(),
      title: "Upgrade Ä / پروژه",
      ownerUserId: owner.id,
      orgId,
      personId,
      dealId,
    };
    expect(await repository.create(input, signal)).toEqual({
      ok: false,
      error: "project_unavailable",
    });
    expect(await enableNativeProjects(h.db, who, true, signal)).toEqual({
      ok: true,
      value: undefined,
    });
    const created = await repository.create(input, signal);
    assert(created.ok);
    expect(await repository.create(input, signal)).toEqual(created);
    const start = {
      intentId: randomUUID(),
      projectId: created.value.projectId,
      expectedRevision: 0,
    };
    const started = await repository.start(start, signal);
    expect(started).toEqual({
      ok: true,
      value: { projectId: created.value.projectId, revision: 1 },
    });
    expect(await repository.start(start, signal)).toEqual(started);
    expect(await repository.read(created.value.projectId, signal)).toMatchObject({
      ok: true,
      value: { state: "active", revision: 1 },
    });
    expect(await businessSnapshot(h)).toEqual(before);
    const appliedLedger = await ledger(h);
    expect(await applyMigrations(h.db, signal)).toMatchObject({ ok: true });
    expect(await ledger(h)).toEqual(appliedLedger);
  } finally {
    await h.close();
  }
});
