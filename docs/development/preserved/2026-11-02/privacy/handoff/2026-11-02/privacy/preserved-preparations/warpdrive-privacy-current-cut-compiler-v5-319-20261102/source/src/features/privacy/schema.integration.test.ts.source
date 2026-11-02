import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";

let h: TestDb;
let actorId: string;
beforeAll(async () => {
  h = await makeTestDb();
  actorId = randomUUID();
  await h.pool.query("INSERT INTO users(id,email,name) VALUES ($1,$2,$3)", [
    actorId,
    "privacy-schema@example.test",
    "Synthetic reviewer",
  ]);
});
afterAll(async () => {
  await h.close();
});

async function newCase() {
  const id = randomUUID();
  await h.pool.query(
    "INSERT INTO privacy_cases(id,kind,created_by,intake_key,intake_digest,metadata_enc) VALUES ($1,'access',$2,$3,'digest',$4)",
    [id, actorId, randomUUID(), Buffer.from("synthetic-ciphertext")],
  );
  return id;
}

test("P03A: additive privacy migration preserves existing users and separates cases from jobs", async () => {
  const caseId = await newCase();
  const result = await h.pool.query(
    "SELECT status,version,scope_version FROM privacy_cases WHERE id=$1",
    [caseId],
  );
  expect(result.rows).toEqual([{ status: "received", version: 1, scope_version: 1 }]);
  expect((await h.pool.query("SELECT id FROM users WHERE id=$1", [actorId])).rowCount).toBe(1);
  await expect(
    h.pool.query("UPDATE privacy_cases SET status='succeeded' WHERE id=$1", [caseId]),
  ).rejects.toMatchObject({ code: "23514" });
});

test("P03B: intake replay and job replay have database uniqueness guarantees", async () => {
  const caseId = await newCase();
  const create =
    "INSERT INTO privacy_jobs(case_id,kind,idempotency_key,requested_by,originating_session_id,authority_generation,member_generation,scope_version,recipient_version,verification_version) VALUES ($1,'export','same-command',$2,$3,1,1,1,1,1)";
  const sessionId = randomUUID();
  await h.pool.query(
    "INSERT INTO sessions(id,user_id,token_hash,expires_at) VALUES ($1,$2,$3,now()+interval '1 hour')",
    [sessionId, actorId, randomUUID()],
  );
  await h.pool.query(create, [caseId, actorId, sessionId]);
  await expect(h.pool.query(create, [caseId, actorId, sessionId])).rejects.toMatchObject({
    code: "23505",
  });
  await expect(
    h.pool.query("UPDATE privacy_jobs SET status='closed' WHERE case_id=$1", [caseId]),
  ).rejects.toMatchObject({ code: "23514" });
});

test("P03B/P05B: receipt and minimal transition evidence cannot be rewritten", async () => {
  const caseId = await newCase();
  await expect(
    h.pool.query("UPDATE privacy_cases SET received_at=now()+interval '1 day' WHERE id=$1", [
      caseId,
    ]),
  ).rejects.toMatchObject({ code: "23514" });
  await h.pool.query(
    "INSERT INTO privacy_case_events(case_id,case_version,command_id,actor_id,action,from_status,to_status) VALUES ($1,1,'received',$2,'received',NULL,'received')",
    [caseId, actorId],
  );
  await expect(
    h.pool.query("UPDATE privacy_case_events SET action='closed' WHERE case_id=$1", [caseId]),
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    h.pool.query("DELETE FROM privacy_case_events WHERE case_id=$1", [caseId]),
  ).rejects.toMatchObject({ code: "23514" });
});

test("P02B: authority stores reject malformed capability and generation shapes", async () => {
  await expect(
    h.pool.query("INSERT INTO privacy_authority(user_id,capabilities) VALUES ($1,'{}')", [actorId]),
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    h.pool.query("INSERT INTO privacy_authority(user_id,generation) VALUES ($1,0)", [actorId]),
  ).rejects.toMatchObject({ code: "23514" });
});
