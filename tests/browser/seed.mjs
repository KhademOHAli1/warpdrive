// This fixture is deliberately unavailable to deployed applications and arbitrary databases.
if (process.env.GITHUB_ACTIONS !== "true" || process.env.CI !== "true") {
  throw new Error("Browser fixtures require an isolated GitHub Actions runner");
}
const database = new URL(process.env.DATABASE_URL ?? "");
if (database.hostname !== "127.0.0.1" || database.pathname !== "/warpdrive_ci") {
  throw new Error("Refusing to seed any database except the loopback CI database");
}
const { db, pool } = await import("../../src/db/client.ts");
const { createBetterAuth } = await import("../../src/features/auth/better/auth.ts");
const { ALL_PERMISSION_FLAG_KEYS } = await import("../../src/constants/permissionFlags.ts");
const id = "00000000-0000-4000-8000-000000000501";
const permission = "00000000-0000-4000-8000-000000000502";
const pipeline = "00000000-0000-4000-8000-000000000503";
try {
  await pool.query(
    "INSERT INTO permission_sets(id,name,flags) VALUES($1,'CI browser permissions',$2)",
    [
      permission,
      JSON.stringify(Object.fromEntries(ALL_PERMISSION_FLAG_KEYS.map((key) => [key, true]))),
    ],
  );
  await pool.query(
    "INSERT INTO users(id,email,name,permission_set_id) VALUES($1,'browser@example.invalid','CI Browser',$2)",
    [id, permission],
  );
  await pool.query(
    "INSERT INTO auth_users(id,email,name,email_verified) VALUES($1,'browser@example.invalid','CI Browser',true)",
    [id],
  );
  const auth = createBetterAuth(db);
  const password = await (await auth.$context).password.hash("CI-browser-only-password-2026!");
  await pool.query(
    "INSERT INTO auth_accounts(user_id,account_id,provider_id,password) VALUES($1,$1,'credential',$2)",
    [id, password],
  );
  await pool.query("INSERT INTO pipelines(id,name,\"order\") VALUES($1,'CI Pipeline',0)", [
    pipeline,
  ]);
  await pool.query(
    "INSERT INTO stages(pipeline_id,name,\"order\",probability) VALUES($1,'CI New',0,10),($1,'CI Qualified',1,50)",
    [pipeline],
  );
  await pool.query(
    "INSERT INTO settings(id,base_currency) VALUES(true,'EUR') ON CONFLICT(id) DO NOTHING",
  );
} finally {
  await pool.end();
}
