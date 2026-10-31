import { randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, expect, test } from "vitest";
import { z } from "zod";
import { makeTestDb, type TestDb } from "@/test/db";

const folder = fileURLToPath(new URL("../../../../drizzle", import.meta.url));
const baseline = mkdtempSync(join(tmpdir(), "warpdrive-auth-migration-"));
let h: TestDb;
beforeAll(async () => {
  h = await makeTestDb();
});
afterAll(async () => {
  await h.close();
  rmSync(baseline, { recursive: true, force: true });
});

test("legacy cutover preserves CRM identity and preferences and invalidates every old access grant", async () => {
  const journal = z
    .object({
      version: z.string(),
      dialect: z.string(),
      entries: z.array(
        z.object({
          idx: z.number(),
          version: z.string(),
          when: z.number(),
          tag: z.string(),
          breakpoints: z.boolean(),
        }),
      ),
    })
    .parse(JSON.parse(readFileSync(join(folder, "meta/_journal.json"), "utf8")));
  const entries = journal.entries.filter((entry) => entry.idx < 77);
  mkdirSync(join(baseline, "meta"));
  writeFileSync(join(baseline, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
  for (const entry of entries)
    copyFileSync(join(folder, `${entry.tag}.sql`), join(baseline, `${entry.tag}.sql`));
  // makeTestDb creates an isolated disposable database. Rebuild only that database at the old schema.
  expect(new URL(h.url).pathname).toMatch(/^\/t_[a-f0-9]+$/);
  await h.pool.query(
    "DROP SCHEMA public CASCADE; DROP SCHEMA drizzle CASCADE; CREATE SCHEMA public",
  );
  await migrate(h.db, { migrationsFolder: baseline });
  const established = randomUUID();
  const invited = randomUUID();
  const person = randomUUID();
  await h.pool.query(
    "INSERT INTO users (id,email,name,google_sub,is_admin) VALUES ($1,'migration-owner@example.com','علی آزمون','google-stable-subject',true)",
    [established],
  );
  await h.pool.query(
    "INSERT INTO users (id,email,name,invited_at) VALUES ($1,'migration-invited@example.com','Jörg',now())",
    [invited],
  );
  await h.pool.query(
    "INSERT INTO persons (id,name,owner_id,visibility_level) VALUES ($1,'Existing customer',$2,'owner')",
    [person, established],
  );
  const preferences = {
    localePreferences: {
      locale: "fa",
      calendar: "persian",
      numberingSystem: "arabext",
      timeZone: "Asia/Tehran",
    },
  };
  await h.pool.query("INSERT INTO user_preferences (user_id,ui) VALUES ($1,$2)", [
    established,
    preferences,
  ]);
  await h.pool.query(
    "INSERT INTO sessions (user_id,token_hash,expires_at) VALUES ($1,'legacy-session-digest',now()+interval '1 day')",
    [established],
  );
  await h.pool.query(
    "INSERT INTO oauth_clients (id,name,redirect_uris) VALUES ('migration-client','Test client','[]')",
  );
  await h.pool.query(
    "INSERT INTO oauth_access_tokens (jti,client_id,user_id,expires_at) VALUES ('legacy-jti','migration-client',$1,now()+interval '1 day')",
    [established],
  );
  await h.pool.query(
    "INSERT INTO oauth_refresh_tokens (token_hash,client_id,user_id,expires_at) VALUES ('legacy-refresh-digest','migration-client',$1,now()+interval '1 day')",
    [established],
  );
  await h.pool.query(
    "INSERT INTO oauth_auth_codes (code_hash,client_id,user_id,redirect_uri,code_challenge,expires_at) VALUES ('legacy-code-digest','migration-client',$1,'https://client.example.com/callback','challenge',now()+interval '1 hour')",
    [established],
  );
  const before = (
    await h.pool.query(
      "SELECT id,email,name,google_sub,is_admin,permission_set_id,primary_visibility_group_id,is_active,invited_at FROM users ORDER BY id",
    )
  ).rows;
  await migrate(h.db, { migrationsFolder: folder });
  expect(
    (
      await h.pool.query(
        "SELECT id,email,name,google_sub,is_admin,permission_set_id,primary_visibility_group_id,is_active,invited_at FROM users ORDER BY id",
      )
    ).rows,
  ).toEqual(before);
  expect((await h.pool.query("SELECT owner_id FROM persons WHERE id=$1", [person])).rows).toEqual([
    { owner_id: established },
  ]);
  expect(
    (await h.pool.query("SELECT ui FROM user_preferences WHERE user_id=$1", [established])).rows,
  ).toEqual([{ ui: preferences }]);
  expect((await h.pool.query("SELECT id,email_verified FROM auth_users")).rows).toEqual([
    { id: established, email_verified: true },
  ]);
  expect(
    (await h.pool.query("SELECT user_id,provider_id,account_id FROM auth_accounts")).rows,
  ).toEqual([{ user_id: established, provider_id: "google", account_id: "google-stable-subject" }]);
  for (const table of ["sessions", "oauth_access_tokens", "oauth_refresh_tokens"])
    expect(
      (await h.pool.query(`SELECT count(*)::int AS count FROM ${table} WHERE revoked_at IS NULL`))
        .rows,
    ).toEqual([{ count: 0 }]);
  expect(
    (
      await h.pool.query(
        "SELECT count(*)::int AS count FROM oauth_auth_codes WHERE consumed_at IS NULL",
      )
    ).rows,
  ).toEqual([{ count: 0 }]);
});
