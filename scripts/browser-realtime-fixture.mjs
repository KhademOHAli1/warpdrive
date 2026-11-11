// Strict source-bound synthetic seed/producer. No application test route is added.
import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const action = process.argv[2];
if (
  ![
    "seed",
    "offline",
    "online",
    "operations-seed",
    "operations-revoke",
    "operations-regrant",
  ].includes(action)
)
  throw Error("Unknown realtime fixture action");
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
  !profile.adminEmail?.endsWith("@example.invalid") ||
  profile.adminEmail === profile.email ||
  !/^[0-9a-f-]{36}$/.test(profile.adminId || "") ||
  profile.adminId === profile.actorId ||
  typeof profile.adminPassword !== "string" ||
  profile.adminPassword.length < 20 ||
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
  "scripts/browser-operations.mjs",
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
    const adminPassword = await (await createBetterAuth(db).$context).password.hash(
      profile.adminPassword,
    );
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
    await client.query(
      "INSERT INTO users(id,email,name,is_admin,is_active) VALUES($1,$2,'Synthetic operations administrator',true,true)",
      [profile.adminId, profile.adminEmail],
    );
    await client.query(
      "INSERT INTO auth_users(id,email,name,email_verified,two_factor_enabled) VALUES($1,$2,'Synthetic operations administrator',true,false)",
      [profile.adminId, profile.adminEmail],
    );
    await client.query(
      "INSERT INTO auth_accounts(user_id,account_id,provider_id,password) VALUES($1,$1,'credential',$2)",
      [profile.adminId, adminPassword],
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
        nativeAdminPasswordIdentity: true,
        forgedSession: false,
        sourceRevision: profile.revision,
      }),
    );
  } else if (action.startsWith("operations-")) {
    const actor = await pool.query(
      "SELECT u.is_active,u.is_admin,a.email_verified,(SELECT count(*) FROM users)::int AS actors,(SELECT count(*) FROM notifications WHERE user_id=$3)::int AS notices FROM users u JOIN auth_users a ON a.id=u.id WHERE u.id=$1 AND u.email=$2",
      [profile.adminId, profile.adminEmail, profile.actorId],
    );
    const expectedAdmin = action !== "operations-regrant";
    if (
      actor.rows.length !== 1 ||
      !actor.rows[0].is_active ||
      !actor.rows[0].email_verified ||
      actor.rows[0].is_admin !== expectedAdmin ||
      actor.rows[0].actors !== 2 ||
      actor.rows[0].notices !== 2
    )
      throw Error("Synthetic operations actor/state differs from fixture");
    if (action === "operations-seed") {
      const empty = await pool.query(
        "SELECT (SELECT count(*) FROM operations_sources)::int AS sources,(SELECT count(*) FROM operations_receipts)::int AS receipts",
      );
      if (empty.rows[0]?.sources !== 0 || empty.rows[0]?.receipts !== 0)
        throw Error("Operations seed requires its empty owned stores");
      const { enrollOperationsSource } = await import("../src/features/operations/storage.ts");
      const { recordOperationsBatch } = await import("../src/features/operations/repository.ts");
      const { PGBOSS_QUEUE_FILE_REAPER, PGBOSS_QUEUE_EMAIL_SEND } = await import(
        "../src/constants/jobNames.ts"
      );
      const host = await enrollOperationsSource(db, "host_collector", signal);
      const app = await enrollOperationsSource(db, "application_sampler", signal);
      const clock = await pool.query(
        "SELECT floor(extract(epoch FROM clock_timestamp())*1000)::text AS now",
      );
      const now = Number(clock.rows[0]?.now);
      if (!Number.isSafeInteger(now)) throw Error("Fixture database clock unavailable");
      async function record(binding, sequence, observedAtMs, observations) {
        const result = await recordOperationsBatch(
          db,
          binding,
          JSON.stringify({
            schemaVersion: 2,
            generationId: binding.generationId,
            sequence,
            observedAtMs,
            observations,
          }),
          signal,
        );
        if (
          !result.ok ||
          result.value.replayed ||
          result.value.appliedObservations !== observations.length ||
          result.value.admissionState !== "ready"
        )
          throw Error("Real operations repository did not admit fixture observations");
      }
      const component = {
        kind: "component",
        component: "web",
        installed: { evidence: "unchecked" },
        latencyMs: null,
      };
      await record(host, 1, now, [{ ...component, state: "failed", reason: "check_failed" }]);
      await record(host, 2, now, [{ ...component, state: "healthy", reason: "ok" }]);
      // A fresh batch does not renew an old queue sample. Missing gauges stay null.
      await record(app, 1, now, [
        {
          kind: "queue",
          queue: PGBOSS_QUEUE_FILE_REAPER,
          state: "healthy",
          reason: "ok",
          sampledAtMs: now - 600000,
          pendingCount: 0,
          activeCount: 0,
          readyOldestAgeMs: null,
          lastProgressAtMs: null,
        },
      ]);
      await record(app, 2, now, [
        {
          kind: "queue",
          queue: PGBOSS_QUEUE_EMAIL_SEND,
          state: "unknown",
          reason: "not_reported",
          sampledAtMs: null,
          pendingCount: null,
          activeCount: null,
          readyOldestAgeMs: null,
          lastProgressAtMs: null,
        },
        { kind: "provider", provider: "smtp", state: "unknown", reason: "not_reported" },
      ]);
      const proof = await pool.query(
        "SELECT (SELECT count(*) FROM operations_sources)::int AS sources,(SELECT count(*) FROM operations_receipts)::int AS receipts,(SELECT count(*) FROM operations_current)::int AS current,(SELECT count(*) FROM operations_incidents WHERE recovered_at IS NOT NULL)::int AS recovered",
      );
      const facts = proof.rows[0];
      if (
        facts?.sources !== 2 ||
        facts.receipts !== 4 ||
        facts.current !== 4 ||
        facts.recovered !== 1
      )
        throw Error("Durable operations fixture facts were not proven");
      console.log(
        JSON.stringify({
          ok: true,
          action,
          sourceRevision: profile.revision,
          actualOperationsRepository: true,
          enrolledSources: 2,
          receipts: 4,
          currentObservations: 4,
          recoveredIncidents: 1,
        }),
      );
    } else {
      // Test-only owned identity mutation under the same cooperating authority fence.
      // This qualifies read revocation, not the administrator-management UI journey.
      const { withCurrentAuthority } = await import("../src/features/auth/currentAuthority.ts");
      const { sql } = await import("drizzle-orm");
      const assurance = await pool.query(
        "SELECT a.two_factor_enabled,EXISTS(SELECT 1 FROM sessions s WHERE s.user_id=a.id AND s.assurance='mfa' AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()) AS mfa FROM auth_users a WHERE a.id=$1",
        [profile.adminId],
      );
      if (assurance.rows[0]?.two_factor_enabled !== true || assurance.rows[0]?.mfa !== true)
        throw Error("Native administrator MFA session was not established");
      const granted = action === "operations-regrant";
      await withCurrentAuthority(db, "write", signal, async (tx) => {
        const changed = await tx.execute(sql`UPDATE users SET is_admin=${granted}
          WHERE id=${profile.adminId} AND email=${profile.adminEmail} AND is_active=true
          AND is_admin=${!granted} RETURNING id`);
        if (changed.rows.length !== 1)
          throw Error("Fixture authority transition was not exclusive");
      });
      console.log(
        JSON.stringify({
          ok: true,
          action,
          sourceRevision: profile.revision,
          committedAuthorityChange: true,
          nativeMfaSession: true,
          admin: granted,
          fixtureMutationOnly: true,
        }),
      );
    }
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
