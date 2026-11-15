import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, test } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";

let h: TestDb;
beforeAll(async () => {
  h = await makeTestDb();
});
afterAll(async () => {
  await h.close();
});

const migration = readFileSync(
  new URL("../../../../drizzle/0119_device_session_lifetime.sql", import.meta.url),
  "utf8",
);
const restorePreviousPolicySchema = `
  DELETE FROM auth_policies;
  ALTER TABLE auth_policies DROP CONSTRAINT auth_policy_limits;
  ALTER TABLE auth_policies ALTER COLUMN idle_minutes SET DEFAULT 30;
  ALTER TABLE auth_policies ALTER COLUMN absolute_hours SET DEFAULT 168;
  ALTER TABLE auth_policies ADD CONSTRAINT auth_policy_limits CHECK
    (idle_minutes BETWEEN 5 AND 1440 AND absolute_hours BETWEEN 1 AND 720
     AND fresh_minutes BETWEEN 1 AND 15 AND fresh_minutes <= idle_minutes);
`;

test("populated policy upgrade changes the former timeout defaults while retaining MFA and freshness", async () => {
  await h.pool.query(restorePreviousPolicySchema);
  await h.pool.query(
    "INSERT INTO auth_policies (id,require_mfa_for_all,fresh_minutes) VALUES (true,true,3)",
  );
  await h.pool.query(migration);
  const after = await h.pool.query(
    "SELECT require_mfa_for_all,idle_minutes,absolute_hours,fresh_minutes FROM auth_policies",
  );
  expect(after.rows).toEqual([
    { require_mfa_for_all: true, idle_minutes: 20160, absolute_hours: 336, fresh_minutes: 3 },
  ]);
  await expect(h.pool.query("UPDATE auth_policies SET idle_minutes=20161")).rejects.toMatchObject({
    code: "23514",
  });
});

test("a deliberately shorter configured policy survives the same migration", async () => {
  await h.pool.query(restorePreviousPolicySchema);
  await h.pool.query(
    "INSERT INTO auth_policies (id,require_mfa_for_all,idle_minutes,absolute_hours,fresh_minutes) VALUES (true,true,15,12,3)",
  );
  await h.pool.query(migration);
  const after = await h.pool.query(
    "SELECT require_mfa_for_all,idle_minutes,absolute_hours,fresh_minutes FROM auth_policies",
  );
  expect(after.rows).toEqual([
    { require_mfa_for_all: true, idle_minutes: 15, absolute_hours: 12, fresh_minutes: 3 },
  ]);
});

test("widening the default does not reactivate a modern session that already expired while idle", async () => {
  await h.pool.query(restorePreviousPolicySchema);
  const person = await h.pool.query(
    "INSERT INTO users(email,name) VALUES('session-upgrade@example.test','Session upgrade') RETURNING id",
  );
  const userId = person.rows[0].id as string;
  await h.pool.query(
    `INSERT INTO sessions(user_id,token_hash,expires_at,last_seen_at,created_at,auth_method,assurance)
    VALUES ($1,'expired-before-upgrade',now()+interval '1 day',now()-interval '31 minutes',now()-interval '1 hour','password','password'),
           ($1,'live-before-upgrade',now()+interval '1 day',now(),now()-interval '1 hour','password','password'),
           ($1,'legacy-compatibility',now()+interval '1 day',now()-interval '31 minutes',now()-interval '1 hour','legacy','legacy')`,
    [userId],
  );
  await h.pool.query(migration);
  const result = await h.pool.query(
    "SELECT token_hash,revoked_at IS NOT NULL AS revoked FROM sessions WHERE user_id=$1 ORDER BY token_hash",
    [userId],
  );
  expect(result.rows).toEqual([
    { token_hash: "expired-before-upgrade", revoked: true },
    { token_hash: "legacy-compatibility", revoked: false },
    { token_hash: "live-before-upgrade", revoked: false },
  ]);
});
