import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import * as schema from "@/db/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import { createNativeProjectRepository } from "./nativeProject";
import { enableNativeProjects, projectCreationOptions } from "./nativeViews";

let h: TestDb;
beforeAll(async () => {
  h = await makeTestDb();
});
afterAll(async () => {
  await h.close();
});
const signal = () => AbortSignal.timeout(10_000);
async function fixture() {
  const id = randomUUID();
  await h.pool.query(
    "INSERT INTO users(id,email,name,is_admin) VALUES($1,$2,'Expiry fixture',true)",
    [id, `${id}@example.test`],
  );
  const sessionId = randomUUID();
  await h.pool.query(
    "INSERT INTO sessions(id,user_id,token_hash,expires_at,auth_method,assurance) VALUES($1,$2,$3,clock_timestamp()+interval '60 seconds','legacy','legacy')",
    [sessionId, id, randomUUID()],
  );
  const orgId = randomUUID();
  await h.pool.query(
    "INSERT INTO organizations(id,name,owner_id,visibility_level) VALUES($1,'Private test client',$2,'all')",
    [orgId, id],
  );
  await h.pool.query(
    "INSERT INTO agency_project_settings(id,enabled) VALUES(true,true) ON CONFLICT(id) DO UPDATE SET enabled=true",
  );
  return {
    who: { userId: id, sessionId },
    input: {
      intentId: randomUUID(),
      ownerUserId: id,
      title: "Rollback fixture",
      orgId,
      personId: null,
      dealId: null,
    },
  };
}
async function expiryWhileBlocked(sessionId: string, queryFragment: string) {
  const deadline = Date.now() + 5000;
  while (true) {
    const row = (
      await h.pool.query<{ blocked: boolean }>(
        "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE $1) AS blocked",
        [`%${queryFragment}%`],
      )
    ).rows[0];
    if (row?.blocked === true) break;
    if (Date.now() >= deadline) throw new TypeError("Expected a real PostgreSQL lock wait");
    await delay(10);
  }
  await h.pool.query(
    "SELECT pg_sleep(greatest(0,extract(epoch from(expires_at-clock_timestamp()))+0.02)) FROM sessions WHERE id=$1",
    [sessionId],
  );
}

test("module enable rolls back when a real settings row wait crosses native session expiry", async () => {
  const f = await fixture();
  await h.pool.query("UPDATE agency_project_settings SET enabled=false");
  const locker = await h.pool.connect();
  let pending: ReturnType<typeof enableNativeProjects> | undefined;
  try {
    await locker.query("BEGIN");
    await locker.query("SELECT * FROM agency_project_settings FOR UPDATE");
    await h.pool.query(
      "UPDATE sessions SET expires_at=clock_timestamp()+interval '1 second' WHERE id=$1",
      [f.who.sessionId],
    );
    pending = enableNativeProjects(h.db, f.who, true, signal());
    await expiryWhileBlocked(f.who.sessionId, 'insert into "agency_project_settings"');
    await locker.query("COMMIT");
    expect(await pending).toEqual({ ok: false, error: "project_unavailable" });
    expect((await h.pool.query("SELECT enabled FROM agency_project_settings")).rows).toEqual([
      { enabled: false },
    ]);
  } finally {
    await locker.query("ROLLBACK");
    locker.release();
    await pending;
  }
});

test("creation options withhold private rows when a real CRM table wait crosses session expiry", async () => {
  const f = await fixture();
  const locker = await h.pool.connect();
  let pending: ReturnType<typeof projectCreationOptions> | undefined;
  try {
    await locker.query("BEGIN");
    await locker.query("LOCK TABLE organizations IN ACCESS EXCLUSIVE MODE");
    await h.pool.query(
      "UPDATE sessions SET expires_at=clock_timestamp()+interval '1 second' WHERE id=$1",
      [f.who.sessionId],
    );
    pending = projectCreationOptions(h.db, f.who, "Private", signal());
    await expiryWhileBlocked(f.who.sessionId, 'from "organizations"');
    await locker.query("COMMIT");
    expect(await pending).toEqual({ ok: false, error: "project_unavailable" });
  } finally {
    await locker.query("ROLLBACK");
    locker.release();
    await pending;
  }
});

test("exact abort at the real rollback acknowledgement overrides the saved project failure", async () => {
  const f = await fixture();
  const pool = new Pool({ connectionString: h.url, max: 1, pipeline: false });
  const client = await pool.connect();
  const controller = new AbortController();
  const reason = Object.freeze({ kind: "agency_rollback_ack_abort", nonce: randomUUID() });
  let rollbackTags = 0;
  let transactionReady = 0;
  let idleAcks = 0;
  const onCommand = (message: { text?: string }) => {
    if (message.text === "ROLLBACK") rollbackTags++;
  };
  const onReady = (message: { status?: string }) => {
    if (message.status === "T") {
      transactionReady++;
      expect(controller.signal.aborted).toBe(false);
    }
    if (message.status === "I" && rollbackTags > 0) {
      idleAcks++;
      controller.abort(reason);
    }
  };
  try {
    await h.pool.query(
      "CREATE FUNCTION agency_test_suppress_history() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NULL; END$$; CREATE TRIGGER agency_test_suppress_history BEFORE INSERT ON agency_project_history FOR EACH ROW EXECUTE FUNCTION agency_test_suppress_history()",
    );
    const before = (await h.pool.query("SELECT count(*)::int AS count FROM agency_projects")).rows;
    client.connection.on("commandComplete", onCommand);
    client.connection.on("readyForQuery", onReady);
    const repository = createNativeProjectRepository(drizzle(client, { schema }), f.who);
    const outcome = await repository.create(f.input, controller.signal).then(
      (value) => ({ kind: "resolved", value }),
      (error: unknown) => ({ kind: "rejected", error }),
    );
    expect(transactionReady).toBeGreaterThan(0);
    expect(rollbackTags).toBe(1);
    expect(idleAcks).toBe(1);
    expect(client.getTransactionStatus()).toBe("I");
    expect((await h.pool.query("SELECT count(*)::int AS count FROM agency_projects")).rows).toEqual(
      before,
    );
    expect(outcome).toEqual({ kind: "rejected", error: reason });
    expect("error" in outcome ? outcome.error : undefined).toBe(reason);
  } finally {
    client.connection.off("commandComplete", onCommand);
    client.connection.off("readyForQuery", onReady);
    client.release(true);
    await pool.end();
    await h.pool.query(
      "DROP TRIGGER IF EXISTS agency_test_suppress_history ON agency_project_history; DROP FUNCTION IF EXISTS agency_test_suppress_history()",
    );
  }
});
