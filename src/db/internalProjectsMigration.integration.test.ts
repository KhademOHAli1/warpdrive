import { randomUUID } from "node:crypto";
import { assert, expect, test } from "vitest";
import { env } from "@/config/env";
import { createNativeProjectRepository } from "@/features/agency-projects/nativeProject";
import { listNativeProjects } from "@/features/agency-projects/nativeProjectList";
import { createProjectReplayCodec } from "@/features/agency-projects/nativeReplay";
import { replayContext } from "@/features/agency-projects/persistence/projectRepositoryReplay";
import type { ProjectReplayInput } from "@/features/agency-projects/persistence/projectRepositoryTypes";
import type { TestDb } from "@/test/db";
import { applyMigrations } from "./migrate";
import {
  canonicalFolder,
  freshMigrationDb,
  installPrefix,
  ledger,
  seedHistoricalUser,
} from "./migrationAdmission.test-helpers";
import { readCanonicalMigrations } from "./migrationAdmissionSource";
import { seedPipelineWithStages } from "./testing/factories";

async function agencySnapshot(h: TestDb) {
  const result = await h.pool.query<{ value: unknown }>(`
    SELECT jsonb_build_object(
      'project', (SELECT to_jsonb(p) - 'kind' FROM agency_projects p),
      'member', (SELECT to_jsonb(m) - 'project_guest' FROM agency_project_members m),
      'setting', (SELECT to_jsonb(s) FROM agency_project_settings s),
      'history', (SELECT jsonb_agg(to_jsonb(h) ORDER BY revision) FROM agency_project_history h),
      'requests', (SELECT jsonb_agg(to_jsonb(r) ORDER BY result_revision) FROM agency_project_requests r),
      'organization', (SELECT to_jsonb(o) FROM organizations o),
      'person', (SELECT to_jsonb(p) FROM persons p),
      'deal', (SELECT to_jsonb(d) FROM deals d)
    ) AS value
  `);
  return result.rows[0]?.value;
}

async function legacySession(h: TestDb, userId: string) {
  const sessionId = randomUUID();
  await h.pool.query(
    "INSERT INTO sessions(id,user_id,token_hash,expires_at,auth_method,assurance) VALUES($1,$2,$3,clock_timestamp()+interval '5 minutes','legacy','legacy')",
    [sessionId, userId, randomUUID()],
  );
  return { userId, sessionId };
}

async function seedLegacyReceipt(
  h: TestDb,
  actorId: string,
  projectId: string,
  input: ProjectReplayInput,
  signal: AbortSignal,
) {
  const historyId = randomUUID();
  const starting = "projectId" in input;
  const operation = starting ? "start" : "create";
  const revision = starting ? 1 : 0;
  await h.pool.query(
    `INSERT INTO agency_project_history
      (id,project_id,recorded_by_user_id,operation,policy_version,previous_revision,revision,previous_state,state)
      VALUES($1,$2,$3,$4,1,$5,$6,$7,$8)`,
    [
      historyId,
      projectId,
      actorId,
      operation,
      starting ? 0 : null,
      revision,
      starting ? "planned" : null,
      starting ? "active" : "planned",
    ],
  );
  const codec = createProjectReplayCodec(Buffer.from(env.TOKEN_ENCRYPTION_KEY, "base64"));
  const binding = replayContext(actorId, operation, input.intentId, projectId, revision, historyId);
  const sealed = await codec.seal(binding, input, signal);
  assert(sealed.ok);
  await h.pool.query(
    `INSERT INTO agency_project_requests
      (actor_user_id,operation,intent_id,project_id,result_revision,history_id,payload_state,private_payload,key_id)
      VALUES($1,$2,$3,$4,$5,$6,'retained',$7,$8)`,
    [
      actorId,
      operation,
      input.intentId,
      projectId,
      revision,
      historyId,
      sealed.value.bytes,
      sealed.value.keyId,
    ],
  );
}

async function seedClientProject(h: TestDb, signal: AbortSignal) {
  const creator = await seedHistoricalUser(h, { isAdmin: true });
  const owner = await seedHistoricalUser(h);
  const outsider = await seedHistoricalUser(h, { isAdmin: true });
  const who = await legacySession(h, creator.id);
  const outside = await legacySession(h, outsider.id);
  const {
    pipeline,
    stages: [stage],
  } = await seedPipelineWithStages(h.db, ["Client pipeline"]);
  assert(stage !== undefined);
  const [orgId, personId, dealId, projectId] = [
    randomUUID(),
    randomUUID(),
    randomUUID(),
    randomUUID(),
  ];
  await h.pool.query(
    "INSERT INTO organizations(id,name,owner_id,visibility_level) VALUES($1,'Client organization',$2,'all')",
    [orgId, owner.id],
  );
  await h.pool.query(
    "INSERT INTO persons(id,name,owner_id,org_id,visibility_level) VALUES($1,'Client contact',$2,$3,'all')",
    [personId, owner.id, orgId],
  );
  await h.pool.query(
    `INSERT INTO deals(id,title,owner_id,pipeline_id,stage_id,org_id,person_id,status,won_time,visibility_level)
      VALUES($1,'Client engagement',$2,$3,$4,$5,$6,'won','2026-11-19T10:00:00Z','all')`,
    [dealId, owner.id, pipeline.id, stage.id, orgId, personId],
  );
  const create = {
    intentId: randomUUID(),
    title: "Client project",
    ownerUserId: owner.id,
    orgId,
    personId,
    dealId,
  };
  const start = { intentId: randomUUID(), projectId, expectedRevision: 0 };
  await h.pool.query("INSERT INTO agency_project_settings(id,enabled) VALUES(true,true)");
  await h.pool.query(
    `INSERT INTO agency_projects(id,title,owner_user_id,org_id,person_id,deal_id,state,revision)
      VALUES($1,$2,$3,$4,$5,$6,'active',1)`,
    [projectId, create.title, owner.id, orgId, personId, dealId],
  );
  await h.pool.query(
    "INSERT INTO agency_project_members(project_id,user_id,project_edit) VALUES($1,$2,true)",
    [projectId, creator.id],
  );
  await seedLegacyReceipt(h, creator.id, projectId, create, signal);
  await seedLegacyReceipt(h, creator.id, projectId, start, signal);
  return { who, outside, projectId, create, start };
}

test("upgrades populated 0119 while preserving Agency identity, access and create/start receipts", async () => {
  const h = await freshMigrationDb();
  const signal = AbortSignal.timeout(30_000);
  try {
    await installPrefix(h, 120);
    const { who, outside, projectId, create, start } = await seedClientProject(h, signal);
    const before = await agencySnapshot(h);
    const oldLedger = await ledger(h);
    expect(oldLedger).toHaveLength(120);

    expect(await applyMigrations(h.db, signal)).toEqual({ ok: true, value: { applied: true } });
    expect(await agencySnapshot(h)).toEqual(before);
    expect((await h.pool.query("SELECT id, kind FROM agency_projects")).rows).toEqual([
      { id: projectId, kind: "client" },
    ]);
    expect(
      (
        await h.pool.query(
          "SELECT count(*)::int AS count FROM agency_project_members WHERE project_guest",
        )
      ).rows,
    ).toEqual([{ count: 0 }]);
    const upgradedLedger = await ledger(h);
    const canonical = await readCanonicalMigrations(canonicalFolder, signal);
    assert(canonical.ok);
    const projectMigration = canonical.value[oldLedger.length];
    assert(projectMigration !== undefined);
    expect(projectMigration.tag).toBe("0120_internal_projects");
    expect(upgradedLedger).toHaveLength(canonical.value.length);
    expect(upgradedLedger[oldLedger.length]).toMatchObject({
      hash: projectMigration.hash,
      created_at: String(projectMigration.when),
    });
    expect(upgradedLedger.slice(0, oldLedger.length)).toEqual(oldLedger);
    expect(await applyMigrations(h.db, signal)).toMatchObject({ ok: true });
    expect(await ledger(h)).toEqual(upgradedLedger);

    const client = createNativeProjectRepository(h.db, who);
    expect(await client.create(create, signal)).toEqual({
      ok: true,
      value: { projectId, revision: 0 },
    });
    expect(await client.start(start, signal)).toEqual({
      ok: true,
      value: { projectId, revision: 1 },
    });
    expect(await client.read(projectId, signal)).toMatchObject({
      ok: true,
      value: {
        id: projectId,
        revision: 1,
        state: "active",
        orgId: create.orgId,
        personId: create.personId,
        dealId: create.dealId,
      },
    });
    expect(await createNativeProjectRepository(h.db, outside).read(projectId, signal)).toEqual({
      ok: false,
      error: "project_unavailable",
    });
    expect(await agencySnapshot(h)).toEqual(before);

    const internalId = randomUUID();
    await h.pool.query(
      "INSERT INTO agency_projects(id,kind,title,owner_user_id) VALUES($1,'internal','Internal project',$2)",
      [internalId, who.userId],
    );
    const listed = await listNativeProjects(h.db, who, { filters: { schemaVersion: 1 } }, signal);
    assert(listed.ok);
    expect(listed.value.items.map((project) => project.id)).toEqual([projectId]);
    expect(await client.read(internalId, signal)).toEqual({
      ok: false,
      error: "project_unavailable",
    });
  } finally {
    await h.close();
  }
});
