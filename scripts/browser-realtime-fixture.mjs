// Strict source-bound synthetic seed/producer. No application test route is added.
import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const action = process.argv[2];
if (!["seed", "offline", "online"].includes(action)) throw Error("Unknown realtime fixture action");
const root = realpathSync(fileURLToPath(new URL("../", import.meta.url)));
const profile = JSON.parse(readFileSync(process.env.BROWSER_REALTIME_PROFILE, "utf8"));
const origin = new URL(profile.baseUrl);
const database = new URL(process.env.DATABASE_URL);
if (
  !/^[a-f0-9]{40}$/.test(profile.revision || "") ||
  origin.protocol !== "https:" ||
  origin.hostname !== "127.0.0.1" ||
  !origin.port ||
  origin.pathname !== "/" ||
  database.protocol !== "postgres:" ||
  database.hostname !== "127.0.0.1" ||
  database.port !== String(profile.databasePort) ||
  database.username !== "smoke" ||
  database.pathname !== "/warpdrive_image_smoke" ||
  database.search ||
  database.hash ||
  process.env.NODE_ENV !== "production" ||
  process.env.BUN_OPTIONS !== "--no-env-file" ||
  process.env.AUTH_GOOGLE_ENABLED !== "false" ||
  process.env.NEWSLETTER_DELIVERY_ENABLED !== "false" ||
  process.env.DISABLE_TELEMETRY !== "true" ||
  process.env.DISABLE_UPDATE_CHECK !== "true" ||
  process.env.AUTH_SMTP_HOST !== "127.0.0.1" ||
  process.env.AUTH_SMTP_PORT !== "9" ||
  process.env.DATABASE_URL_FILE ||
  !profile.email?.endsWith("@example.invalid") ||
  !/^[0-9a-f-]{36}$/.test(profile.actorId || "") ||
  !/^[0-9a-f-]{36}$/.test(profile.pipelineId || "") ||
  typeof profile.password !== "string" ||
  profile.password.length < 20
)
  throw Error("Source fixture target was not admitted");
function git(args) {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", timeout: 10000 });
  if (result.error || result.status !== 0)
    throw Error("Source fixture binding could not be established");
  return result.stdout.trim();
}
if (git(["rev-parse", "HEAD"]) !== profile.revision)
  throw Error("Source fixture revision differs from final images");
git(["diff", "--quiet", "HEAD", "--"]);
for (const path of [
  "scripts/deployment/browser_realtime_smoke.py",
  "scripts/deployment/test_browser_realtime_smoke.py",
  "scripts/browser-realtime.mjs",
  "scripts/browser-realtime-fixture.mjs",
])
  git(["cat-file", "-e", `${profile.revision}:${path}`]);
if (
  git(["status", "--porcelain", "--untracked-files=all"]) ||
  git(["ls-files", "--others", "--", "src", "scripts", "patches", "deploy", "public"])
)
  throw Error("Uncommitted fixture source cannot establish exact revision binding");

let client, pool;
try {
  // Imported only after target/revision admission. Runtime images receive no source mount.
  const connection = await import("../src/db/client.ts");
  pool = connection.pool;
  const { db } = connection;
  const { setPreference } = await import("../src/features/notifications/preferences.ts");
  const signal = AbortSignal.timeout(15000);
  if (action === "seed") {
    const { createBetterAuth } = await import("../src/features/auth/better/auth.ts");
    const { ALL_PERMISSION_FLAG_KEYS } = await import("../src/constants/permissionFlags.ts");
    const password = await (await createBetterAuth(db).$context).password.hash(profile.password);
    client = await pool.connect();
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout='2s'");
    await client.query("SET LOCAL statement_timeout='5s'");
    const counts = await client.query(
      "SELECT current_database() AS name,(SELECT count(*) FROM users)::int AS users,(SELECT count(*) FROM auth_users)::int AS auth,(SELECT count(*) FROM sessions)::int AS sessions",
    );
    if (
      counts.rows[0]?.name !== "warpdrive_image_smoke" ||
      counts.rows[0].users ||
      counts.rows[0].auth ||
      counts.rows[0].sessions
    )
      throw Error("Synthetic seed requires its fresh empty fixture database");
    const granted = new Set(["deal.create", "activity.create", "workflow.view", "workflow.create"]);
    const flags = JSON.stringify(
      Object.fromEntries(ALL_PERMISSION_FLAG_KEYS.map((key) => [key, granted.has(key)])),
    );
    await client.query(
      "INSERT INTO permission_sets(id,name,flags) VALUES($1,'Browser realtime fixture',$2)",
      [profile.permissionId, flags],
    );
    await client.query(
      "INSERT INTO users(id,email,name,is_admin,is_active,permission_set_id) VALUES($1,$2,'Synthetic browser realtime',false,true,$3)",
      [profile.actorId, profile.email, profile.permissionId],
    );
    await client.query(
      "INSERT INTO auth_users(id,email,name,email_verified,two_factor_enabled) VALUES($1,$2,'Synthetic browser realtime',true,false)",
      [profile.actorId, profile.email],
    );
    await client.query(
      "INSERT INTO auth_accounts(user_id,account_id,provider_id,password) VALUES($1,$2,'credential',$3)",
      [profile.actorId, profile.actorId, password],
    );
    await client.query('INSERT INTO pipelines(id,name,"order") VALUES($1,$2,0)', [
      profile.pipelineId,
      profile.pipelineName,
    ]);
    await client.query(
      "INSERT INTO stages(pipeline_id,name,\"order\") VALUES($1,'New',0),($1,'Qualified',1)",
      [profile.pipelineId],
    );
    await client.query(
      "INSERT INTO settings(id,base_currency) VALUES(true,'EUR') ON CONFLICT(id) DO NOTHING",
    );
    await client.query("COMMIT");
    await setPreference(
      db,
      profile.actorId,
      "workflow_message",
      { inApp: true, email: false },
      signal,
    );
    console.log(
      JSON.stringify({
        ok: true,
        action: "seed",
        nativePasswordIdentity: true,
        forgedSession: false,
        sourceRevision: profile.revision,
      }),
    );
  } else {
    const expected = action === "offline" ? 0 : 1;
    const actor = await pool.query(
      "SELECT u.is_active,u.is_admin,a.email_verified,(SELECT count(*) FROM notifications WHERE user_id=u.id)::int AS notices FROM users u JOIN auth_users a ON a.id=u.id WHERE u.id=$1 AND u.email=$2",
      [profile.actorId, profile.email],
    );
    if (
      actor.rows.length !== 1 ||
      !actor.rows[0].is_active ||
      actor.rows[0].is_admin ||
      !actor.rows[0].email_verified ||
      actor.rows[0].notices !== expected
    )
      throw Error("Synthetic notification actor/state differs from fixture");
    const { createNotification } = await import("../src/features/notifications/produce.ts");
    const result = await createNotification(
      db,
      {
        recipientId: profile.actorId,
        type: "workflow_message",
        entityType: null,
        entityId: null,
        actorId: null,
        payload: {
          title: action === "offline" ? profile.offlineTitle : profile.onlineTitle,
          message: "Synthetic realtime qualification",
        },
      },
      signal,
    );
    if (!result.ok || !("notificationId" in result.value))
      throw Error("Real notification producer did not persist the synthetic notice");
    const receipt = await pool.query(
      "SELECT (SELECT count(*) FROM notifications WHERE user_id=$1)::int AS count,(SELECT email FROM notification_preferences WHERE user_id=$1 AND type='workflow_message') AS email",
      [profile.actorId],
    );
    if (receipt.rows[0]?.count !== expected + 1 || receipt.rows[0]?.email !== false)
      throw Error("Producer persistence/email suppression not verified");
    console.log(
      JSON.stringify({
        ok: true,
        action,
        actualProducer: true,
        notificationCount: expected + 1,
        emailEnabled: false,
        sourceRevision: profile.revision,
      }),
    );
  }
} catch {
  if (client) await client.query("ROLLBACK").catch(() => {});
  console.error(JSON.stringify({ event: "browser.realtime.fixture.failed", action }));
  process.exitCode = 1;
} finally {
  client?.release();
  if (pool) await pool.end();
}
