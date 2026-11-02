import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { applyMigrations } from "@/db/migrate";
import { ledger } from "@/db/migrationAdmission.test-helpers";
import { makeTestDb, type TestDb } from "@/test/db";
import {
  durationBusinessSnapshot,
  durationForeignKeys,
  durationMigrationFixtures,
  durationWaitDueIndex,
  LEGACY_STATUSES,
  seedDurationUpgradeData,
} from "./durationWaitMigration.test-helpers";

async function assertDurationWaitChecks(h: TestDb, run: string, signal: AbortSignal) {
  const client = await h.pool.connect();
  let began = false;
  try {
    await client.query("BEGIN");
    began = true;
    await client.query("SET LOCAL statement_timeout = '5s'");
    const waiting = await client.query(
      `UPDATE workflow_runs SET status='waiting',resume_at=$2,next_node_id='read' WHERE id=$1
      RETURNING status,resume_at,next_node_id,isfinite(resume_at) AS finite`,
      [run, "2026-11-03T10:00:00.000Z"],
    );
    expect(waiting.rows).toEqual([
      {
        status: "waiting",
        resume_at: new Date("2026-11-03T10:00:00.000Z"),
        next_node_id: "read",
        finite: true,
      },
    ]);
    const invalid = [
      { assignment: "resume_at=NULL", constraint: "workflow_runs_wait_state_ck" },
      { assignment: "next_node_id=NULL", constraint: "workflow_runs_wait_state_ck" },
      {
        assignment: "resume_at='infinity'::timestamptz",
        constraint: "workflow_runs_wait_state_ck",
      },
      {
        assignment: "resume_at='-infinity'::timestamptz",
        constraint: "workflow_runs_wait_state_ck",
      },
      ...LEGACY_STATUSES.map((status) => ({
        assignment: `status='${status}'`,
        constraint: "workflow_runs_wait_state_ck",
      })),
      { assignment: "status='unknown',resume_at=NULL", constraint: "workflow_runs_status_ck" },
    ];
    for (const entry of invalid) {
      signal.throwIfAborted();
      await client.query("SAVEPOINT duration_wait_check");
      await expect(
        client.query(`UPDATE workflow_runs SET ${entry.assignment} WHERE id=$1`, [run]),
      ).rejects.toMatchObject({ code: "23514", constraint: entry.constraint });
      await client.query("ROLLBACK TO SAVEPOINT duration_wait_check");
      await client.query("RELEASE SAVEPOINT duration_wait_check");
    }
    signal.throwIfAborted();
  } finally {
    try {
      // Restore the successful waiting control as well as every negative probe.
      if (began) await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  }
}

// New canonical-chain, CHECK, index and rerun assertions are prepared source only;
// they are not part of the earlier owner's SQL-body/native qualification receipt.
it("preserves populated canonical 0..97 workflow and CRM data through canonical 0098", async () => {
  const signal = AbortSignal.timeout(30_000);
  const fixture = await durationMigrationFixtures(signal);
  let h: TestDb | undefined;
  try {
    h = await makeTestDb();
    // Retain the handle before resetting so any reset failure reaches fixture cleanup.
    await h.db.execute(sql`DROP SCHEMA public CASCADE`);
    await h.db.execute(sql`DROP SCHEMA drizzle CASCADE`);
    await h.db.execute(sql`CREATE SCHEMA public`);
    expect(await applyMigrations(h.db, signal, fixture.baselineFolder)).toEqual({
      ok: true,
      value: { applied: true },
    });
    expect(
      (
        await h.pool.query(`SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='workflow_runs' AND column_name='resume_at'`)
      ).rows,
    ).toEqual([]);
    const seeded = await seedDurationUpgradeData(h, signal);
    const beforeLedger = await ledger(h);
    expect(beforeLedger).toHaveLength(98);
    expect(beforeLedger.map((row) => ({ hash: row.hash, created_at: row.created_at }))).toEqual(
      fixture.sources.map((entry) => ({ hash: entry.sha256, created_at: String(entry.when) })),
    );
    const beforeBusiness = await durationBusinessSnapshot(h, false, signal);
    const beforeForeignKeys = await durationForeignKeys(h, signal);
    expect(beforeForeignKeys.length).toBeGreaterThan(0);

    expect(await applyMigrations(h.db, signal, fixture.candidateFolder)).toEqual({
      ok: true,
      value: { applied: true },
    });
    // This qualification ends at 0098 even after later canonical schema additions.
    expect(
      (
        await h.pool.query(`SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='deals' AND column_name='write_version'`)
      ).rows,
    ).toEqual([]);
    const afterLedger = await ledger(h);
    expect(afterLedger.slice(0, beforeLedger.length)).toEqual(beforeLedger);
    expect(afterLedger).toHaveLength(99);
    expect(afterLedger.at(-1)).toMatchObject({
      hash: fixture.candidateHash,
      created_at: String(fixture.candidateWhen),
    });
    expect(await durationBusinessSnapshot(h, true, signal)).toEqual(beforeBusiness);
    expect(await durationForeignKeys(h, signal)).toEqual(beforeForeignKeys);
    expect(
      (
        await h.pool.query(`SELECT data_type,is_nullable FROM information_schema.columns
      WHERE table_schema='public' AND table_name='workflow_runs' AND column_name='resume_at'`)
      ).rows,
    ).toEqual([{ data_type: "timestamp with time zone", is_nullable: "YES" }]);
    expect(
      (
        await h.pool.query(`SELECT status,resume_at IS NULL AS resume_is_null
      FROM workflow_runs ORDER BY status`)
      ).rows,
    ).toEqual([...LEGACY_STATUSES].sort().map((status) => ({ status, resume_is_null: true })));
    const dueIndex = await durationWaitDueIndex(h, signal);
    expect(dueIndex).toEqual([
      {
        index_oid: expect.any(String),
        name: "workflow_runs_wait_due_idx",
        method: "btree",
        indisunique: false,
        indisvalid: true,
        indisready: true,
        indnkeyatts: 2,
        indnatts: 2,
        keys: ["resume_at", "id"],
        predicate: "(status = 'waiting'::text)",
      },
    ]);
    await assertDurationWaitChecks(h, seeded.runs.queued, signal);

    await expect(
      h.pool.query("UPDATE workflows SET published_number=99 WHERE id=$1", [seeded.workflow]),
    ).rejects.toMatchObject({ code: "23503", constraint: "workflows_published_version_fk" });
    await expect(
      h.pool.query("UPDATE workflow_runs SET workflow_id=$2 WHERE id=$1", [
        seeded.runs.queued,
        seeded.otherWorkflow,
      ]),
    ).rejects.toMatchObject({ code: "23503", constraint: "workflow_run_pinned_version_fk" });
    await expect(
      h.pool.query("UPDATE workflow_steps SET run_id=$2 WHERE id=$1", [
        seeded.historicalStep,
        randomUUID(),
      ]),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "workflow_steps_run_id_workflow_runs_id_fk",
    });
    await expect(
      h.pool.query("UPDATE workflow_versions SET name='mutated' WHERE id=$1", [
        seeded.historicalVersion,
      ]),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      h.pool.query("DELETE FROM workflow_versions WHERE id=$1", [seeded.publishedVersion]),
    ).rejects.toMatchObject({ code: "55000" });
    signal.throwIfAborted();
    expect(await durationBusinessSnapshot(h, true, signal)).toEqual(beforeBusiness);
    expect(await ledger(h)).toEqual(afterLedger);
    const beforeRerunRuns = (
      await h.pool.query("SELECT to_jsonb(r) AS value FROM workflow_runs r ORDER BY id")
    ).rows;
    expect(await applyMigrations(h.db, signal, fixture.candidateFolder)).toEqual({
      ok: true,
      value: { applied: true },
    });
    expect(await ledger(h)).toEqual(afterLedger);
    expect(await durationBusinessSnapshot(h, true, signal)).toEqual(beforeBusiness);
    expect(await durationForeignKeys(h, signal)).toEqual(beforeForeignKeys);
    expect(await durationWaitDueIndex(h, signal)).toEqual(dueIndex);
    expect(
      (await h.pool.query("SELECT to_jsonb(r) AS value FROM workflow_runs r ORDER BY id")).rows,
    ).toEqual(beforeRerunRuns);
  } finally {
    try {
      if (h !== undefined) await h.close();
    } finally {
      await fixture.dispose();
    }
  }
}, 45_000);
