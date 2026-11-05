import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Admission must finish before importing the application's effective environment or DB client.
if (
  process.env.GITHUB_ACTIONS !== "true" ||
  process.env.CI !== "true" ||
  process.env.NODE_ENV !== "production"
) {
  throw new Error("Browser fixtures require the isolated production-mode GitHub runner profile");
}
const admission = spawnSync(
  "python3",
  [fileURLToPath(new URL("./delivery/browser_smoke_environment.py", import.meta.url))],
  { env: process.env, stdio: "inherit" },
);
if (admission.error || admission.status !== 0) {
  throw new Error("Browser fixture environment was not admitted");
}

const { db, pool } = await import("../src/db/client.ts");
const { createBetterAuth } = await import("../src/features/auth/better/auth.ts");
const { ALL_PERMISSION_FLAG_KEYS } = await import("../src/constants/permissionFlags.ts");
const id = "00000000-0000-4000-8000-000000000501";
const permission = "00000000-0000-4000-8000-000000000502";
const pipeline = "00000000-0000-4000-8000-000000000503";
const group = "00000000-0000-4000-8000-000000000504";
const regionalActors = [
  {
    id: "00000000-0000-4000-8000-000000000506",
    email: "regional-fa@example.invalid",
    name: "Regional Farsi",
  },
  {
    id: "00000000-0000-4000-8000-000000000507",
    email: "regional-de@example.invalid",
    name: "Regional German",
  },
  {
    id: "00000000-0000-4000-8000-000000000508",
    email: "regional-en@example.invalid",
    name: "Regional English",
  },
];
const granted = new Set(["deal.create", "activity.create", "workflow.view", "workflow.create"]);
let client;
try {
  const auth = createBetterAuth(db);
  const password = await (await auth.$context).password.hash("CI-browser-only-password-2026!");
  client = await pool.connect();
  await client.query("BEGIN");
  await client.query(
    "INSERT INTO permission_sets(id,name,flags) VALUES($1,'CI browser permissions',$2)",
    [
      permission,
      JSON.stringify(
        Object.fromEntries(ALL_PERMISSION_FLAG_KEYS.map((key) => [key, granted.has(key)])),
      ),
    ],
  );
  await client.query("INSERT INTO visibility_groups(id,name) VALUES($1,'CI browser group')", [
    group,
  ]);
  await client.query(
    "INSERT INTO users(id,email,name,is_admin,permission_set_id,primary_visibility_group_id) VALUES($1,'browser@example.invalid','CI Browser',false,$2,$3)",
    [id, permission, group],
  );
  await client.query("INSERT INTO visibility_group_members(group_id,user_id) VALUES($1,$2)", [
    group,
    id,
  ]);
  await client.query(
    "INSERT INTO auth_users(id,email,name,email_verified) VALUES($1,'browser@example.invalid','CI Browser',true)",
    [id],
  );
  await client.query(
    "INSERT INTO auth_accounts(user_id,account_id,provider_id,password) VALUES($1,$2,'credential',$3)",
    [id, id, password],
  );
  await client.query("INSERT INTO pipelines(id,name,\"order\") VALUES($1,'CI Pipeline',0)", [
    pipeline,
  ]);
  await client.query(
    "INSERT INTO stages(pipeline_id,name,\"order\") VALUES($1,'CI New',0),($1,'CI Qualified',1)",
    [pipeline],
  );
  await client.query(
    "INSERT INTO settings(id,base_currency) VALUES(true,'EUR') ON CONFLICT(id) DO NOTHING",
  );
  // Non-default siblings and a second actor make appearance preservation checks substantive.
  await client.query(
    "INSERT INTO users(id,email,name,is_admin) VALUES($1,'appearance-sentinel@example.invalid','Appearance sentinel',false)",
    ["00000000-0000-4000-8000-000000000505"],
  );
  await client.query(
    "INSERT INTO user_preferences(user_id,timezone,density,ui) VALUES($1,'Europe/Berlin','comfortable',$2),($3,'Asia/Tehran','compact',$4)",
    [
      id,
      JSON.stringify({ appearance: "day", winSound: true, dailyActivityTarget: 7 }),
      "00000000-0000-4000-8000-000000000505",
      JSON.stringify({ appearance: "night", winSound: false }),
    ],
  );
  // Fresh regional actors intentionally have no user_preferences rows or locale cookies. The
  // production harness proves that browser hints are persisted through the authorized UI.
  for (const regional of regionalActors) {
    await client.query(
      "INSERT INTO users(id,email,name,is_admin,permission_set_id,primary_visibility_group_id) VALUES($1,$2,$3,false,$4,$5)",
      [regional.id, regional.email, regional.name, permission, group],
    );
    await client.query("INSERT INTO visibility_group_members(group_id,user_id) VALUES($1,$2)", [
      group,
      regional.id,
    ]);
    await client.query(
      "INSERT INTO auth_users(id,email,name,email_verified) VALUES($1,$2,$3,true)",
      [regional.id, regional.email, regional.name],
    );
    await client.query(
      "INSERT INTO auth_accounts(user_id,account_id,provider_id,password) VALUES($1,$1,'credential',$2)",
      [regional.id, password],
    );
  }
  await client.query("COMMIT");
} catch (error) {
  if (client) await client.query("ROLLBACK");
  throw error;
} finally {
  client?.release();
  await pool.end();
}
