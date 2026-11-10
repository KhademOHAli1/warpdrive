import { randomUUID } from "node:crypto";
import { assert, expect, it } from "vitest";
import { applyMigrations } from "./migrate";
import {
  canonicalFolder,
  freshMigrationDb,
  installPrefix,
  ledger,
} from "./migrationAdmission.test-helpers";
import { readCanonicalMigrations } from "./migrationAdmissionSource";
import { seedUser } from "./testing/factories";

it("upgrades populated 0110 without firing activity automation or changing native reminder intent", async () => {
  const h = await freshMigrationDb();
  const signal = AbortSignal.timeout(30_000);
  try {
    await installPrefix(h, 111);
    const user = await seedUser(h.db, { isAdmin: true });
    const type = (await h.pool.query<{ id: string }>("SELECT id FROM activity_types LIMIT 1"))
      .rows[0];
    assert(type !== undefined);
    const activityId = randomUUID();
    await h.pool.query(
      `INSERT INTO activities(id,type_id,subject,owner_id,assignee_id,due_at,duration_minutes)
      VALUES ($1,$2,'Existing event',$3,$3,clock_timestamp()+interval '1 hour',60)`,
      [activityId, type.id, user.id],
    );
    await h.pool.query(
      `INSERT INTO activity_reminder_intents(activity_id,managed,event_time_zone,reminder_time_zone,selection,fire_at,status)
      VALUES ($1,true,'UTC','UTC','{"kind":"before_start","channel":"in_app","leadMinutes":10}',clock_timestamp()+interval '50 minutes','pending')`,
      [activityId],
    );
    const workflowId = randomUUID();
    const definition = {
      schemaVersion: 2,
      trigger: { type: "record.updated", config: { objectName: "activity" } },
      nodes: [],
      edges: [],
      entryNodeIds: [],
    };
    await h.pool.query(
      `INSERT INTO workflows_v2(id,owner_id,name,draft,published_number,active)
      VALUES ($1,$2,'Existing activity automation',$3,1,true)`,
      [workflowId, user.id, definition],
    );
    await h.pool.query(
      `INSERT INTO workflow_v2_versions(workflow_id,number,name,definition,published_by)
      VALUES ($1,1,'Existing activity automation',$2,$3)`,
      [workflowId, definition, user.id],
    );
    const beforeActivity = (
      await h.pool.query("SELECT to_jsonb(a) AS value FROM activities a ORDER BY id")
    ).rows;
    const beforeIntent = (
      await h.pool.query(
        "SELECT to_jsonb(i) AS value FROM activity_reminder_intents i ORDER BY activity_id",
      )
    ).rows;
    const beforeLedger = await ledger(h);
    const triggerState = (
      await h.pool.query(
        "SELECT tgname,tgenabled FROM pg_trigger WHERE tgrelid='activities'::regclass AND NOT tgisinternal ORDER BY tgname",
      )
    ).rows;
    expect((await h.pool.query("SELECT id FROM workflow_v2_record_events")).rows).toHaveLength(0);
    expect(await applyMigrations(h.db, signal)).toMatchObject({ ok: true });
    expect((await h.pool.query("SELECT id FROM workflow_v2_record_events")).rows).toHaveLength(0);
    expect((await h.pool.query("SELECT id FROM workflow_v2_runs")).rows).toHaveLength(0);
    expect((await h.pool.query("SELECT id FROM notifications")).rows).toHaveLength(0);
    expect((await h.pool.query("SELECT id FROM email_send_attempts")).rows).toHaveLength(0);
    expect(
      (
        await h.pool.query(
          "SELECT to_jsonb(a)-ARRAY['version','event_time_zone','calendar_id','event_visibility','availability','reminder_automation_enabled','reminder_engine','reminder_authored_at'] AS value FROM activities a ORDER BY id",
        )
      ).rows,
    ).toEqual(beforeActivity);
    expect(
      (
        await h.pool.query(
          "SELECT to_jsonb(i) AS value FROM activity_reminder_intents i ORDER BY activity_id",
        )
      ).rows,
    ).toEqual(beforeIntent);
    const afterTriggers = (
      await h.pool.query<{ tgname: string; tgenabled: string }>(
        "SELECT tgname,tgenabled FROM pg_trigger WHERE tgrelid='activities'::regclass AND NOT tgisinternal ORDER BY tgname",
      )
    ).rows;
    expect(afterTriggers.filter((trigger) => trigger.tgname.startsWith("workflow_"))).toEqual(
      triggerState,
    );
    expect((await ledger(h)).slice(0, beforeLedger.length)).toEqual(beforeLedger);
    const canonical = await readCanonicalMigrations(canonicalFolder, signal);
    assert(canonical.ok);
    expect(await ledger(h)).toHaveLength(canonical.value.length);
    expect(await applyMigrations(h.db, signal)).toMatchObject({ ok: true });
    await h.pool.query("UPDATE activities SET subject='Explicit user edit' WHERE id=$1", [
      activityId,
    ]);
    expect((await h.pool.query("SELECT event_name FROM workflow_v2_record_events")).rows).toEqual([
      { event_name: "activity.updated" },
    ]);
  } finally {
    await h.close();
  }
});
