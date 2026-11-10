import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// The browser pack imports fixture identifiers. Database setup runs only when this file is
// executed on the admitted runner, after the existing browser packs finish.
const id = (suffix) => `00000000-0000-4000-8000-000000000${suffix}`;

export const ANALYTICS_BROWSER = {
  actorId: id(601),
  actorName: "CI Analytics Viewer",
  email: "analytics-browser@example.invalid",
  password: "CI-browser-only-password-2026!",
  pipelineId: id(602),
  pipelineName: "CI Analytics Pipeline",
  stageId: id(603),
  restrictedGroupId: id(604),
  restrictedPipelineId: id(605),
  restrictedStageId: id(606),
  permissionSetId: id(607),
  timeZone: "Europe/Berlin",
  regional: {
    locale: "en",
    calendar: "gregory",
    country: "DE",
    timeZone: "Europe/Berlin",
    timeZoneMode: "manual",
    numberingSystem: "latn",
  },
};

export const ANALYTICS_DEALS = {
  recorded: { id: id(610), title: "CI Analytics recorded value", value: "123.4567", status: "won" },
  zero: { id: id(611), title: "CI Analytics recorded zero", value: "0.00", status: "won" },
  missing: { id: id(612), title: "CI Analytics missing value", value: null, status: "won" },
  negativeCycle: {
    id: id(613),
    title: "CI Analytics negative cycle",
    value: "10.00",
    status: "won",
  },
  lost: { id: id(614), title: "CI Analytics lost outcome", value: "60.00", status: "lost" },
  boundary: { id: id(615), title: "CI Analytics zone boundary", value: "7.25", status: "won" },
  otherCurrency: { id: id(616), title: "CI Analytics other currency", value: "800", status: "won" },
  otherOwner: { id: id(617), title: "CI Analytics other owner", value: "900", status: "won" },
  hidden: { id: id(618), title: "CI Analytics private sentinel", value: "999", status: "won" },
  restricted: {
    id: id(619),
    title: "CI Analytics restricted pipeline sentinel",
    value: "1000",
    status: "won",
  },
};

export const ANALYTICS_LEADS = {
  linked: id(620),
  secondLink: id(621),
  pending: id(622),
  archived: id(623),
  restricted: id(624),
  hidden: id(625),
  old: id(626),
};

export const ANALYTICS_LEGACY_LOSS = "CI typed reason witness";

export const ANALYTICS_ORGANIZATIONS = {
  visible: id(627),
  private: id(628),
};

const fixtureChannels = {
  recorded: "referral",
  zero: "referral",
  negativeCycle: "CI unrecognized source witness",
  boundary: "web_form",
  otherCurrency: "referral",
  otherOwner: "referral",
  hidden: "referral",
  restricted: "referral",
};

export async function seedAnalyticsBrowserFixtures(
  client,
  { passwordHash, groupId, otherOwnerId },
) {
  const a = ANALYTICS_BROWSER;
  await client.query(
    "INSERT INTO permission_sets(id,name,flags) VALUES($1,'CI analytics viewer',$2)",
    [a.permissionSetId, JSON.stringify({ "data.export": true })],
  );
  await client.query(
    `INSERT INTO users(id,email,name,is_admin,permission_set_id,primary_visibility_group_id)
     VALUES($1,$2,$3,false,$4,$5)`,
    [a.actorId, a.email, a.actorName, a.permissionSetId, groupId],
  );
  await client.query("INSERT INTO visibility_group_members(group_id,user_id) VALUES($1,$2)", [
    groupId,
    a.actorId,
  ]);
  await client.query("INSERT INTO auth_users(id,email,name,email_verified) VALUES($1,$2,$3,true)", [
    a.actorId,
    a.email,
    a.actorName,
  ]);
  await client.query(
    "INSERT INTO auth_accounts(user_id,account_id,provider_id,password) VALUES($1,$2,'credential',$3)",
    [a.actorId, a.actorId, passwordHash],
  );
  await client.query(
    "INSERT INTO user_preferences(user_id,timezone,density,ui) VALUES($1,$2,'comfortable',$3)",
    [
      a.actorId,
      a.timeZone,
      JSON.stringify({ appearance: "system", localePreferences: a.regional }),
    ],
  );
  await client.query('INSERT INTO pipelines(id,name,"order") VALUES($1,$2,100)', [
    a.pipelineId,
    a.pipelineName,
  ]);
  await client.query('INSERT INTO stages(id,pipeline_id,name,"order") VALUES($1,$2,$3,0)', [
    a.stageId,
    a.pipelineId,
    "CI Analytics Stage",
  ]);
  await client.query("INSERT INTO visibility_groups(id,name) VALUES($1,$2)", [
    a.restrictedGroupId,
    "CI Analytics Restricted Group",
  ]);
  await client.query(
    'INSERT INTO pipelines(id,name,"order",visibility_group_id) VALUES($1,$2,101,$3)',
    [a.restrictedPipelineId, "CI Analytics Restricted Pipeline", a.restrictedGroupId],
  );
  await client.query('INSERT INTO stages(id,pipeline_id,name,"order") VALUES($1,$2,$3,0)', [
    a.restrictedStageId,
    a.restrictedPipelineId,
    "CI Analytics Restricted Stage",
  ]);

  // The boundary win occurs at 00:30 UTC on a recent day, still the previous day in Los Angeles.
  // The other outcomes close at noon UTC on the following day, inside Last 30 in either zone
  // and outside the one-day boundary witness. Store values as PostgreSQL decimals.
  const fixtures = [
    ["recorded", 4],
    ["zero", 2],
    ["missing", 1],
    ["negativeCycle", -1],
    ["lost", 1],
    ["boundary", 3],
    ["otherCurrency", 1],
    ["otherOwner", 1],
    ["hidden", 1],
    ["restricted", 1],
  ];
  for (const [key, age] of fixtures) {
    const row = ANALYTICS_DEALS[key];
    await client.query(
      `WITH anchor AS (
         SELECT (transaction_timestamp() AT TIME ZONE 'UTC')::date - 3 AS fixture_day,
                public.warpdrive_base_currency() AS currency
       ), instant AS (
         SELECT ((fixture_day + CASE WHEN $9::boolean THEN 0 ELSE 1 END
                      + CASE WHEN $9::boolean THEN time '00:30' ELSE time '12:00' END)
                 AT TIME ZONE 'UTC') AS closed_at,
                CASE WHEN $10::boolean THEN CASE currency WHEN 'EUR' THEN 'USD' ELSE 'EUR' END
                     ELSE currency END AS currency
         FROM anchor
       )
       INSERT INTO deals(id,title,status,value,currency,pipeline_id,stage_id,owner_id,
                         visibility_level,created_at,won_time,lost_time,source_channel)
       SELECT $1::uuid,$2::text,$3::deal_status,$4::numeric,currency,
              $5::uuid,$6::uuid,$7::uuid,$8::visibility_level,
              closed_at - $11::integer * interval '24 hours',
              CASE WHEN $3::deal_status = 'won' THEN closed_at END,
              CASE WHEN $3::deal_status = 'lost' THEN closed_at END,$12::text
       FROM instant`,
      [
        row.id,
        row.title,
        row.status,
        row.value,
        key === "restricted" ? a.restrictedPipelineId : a.pipelineId,
        key === "restricted" ? a.restrictedStageId : a.stageId,
        key === "otherOwner" || key === "hidden" ? otherOwnerId : a.actorId,
        key === "otherOwner" ? "all" : "owner",
        key === "boundary",
        key === "otherCurrency",
        age,
        fixtureChannels[key] ?? null,
      ],
    );
  }
  await client.query(
    `INSERT INTO organizations(id,name,owner_id,visibility_level)
     VALUES($1,'CI visible linked organization',$2,'owner'),
           ($3,'CI withheld linked organization',$4,'owner')`,
    [ANALYTICS_ORGANIZATIONS.visible, a.actorId, ANALYTICS_ORGANIZATIONS.private, otherOwnerId],
  );
  await client.query("UPDATE deals SET org_id=$1 WHERE id=ANY($2::uuid[])", [
    ANALYTICS_ORGANIZATIONS.visible,
    [ANALYTICS_DEALS.recorded.id, ANALYTICS_DEALS.zero.id],
  ]);
  await client.query("UPDATE deals SET org_id=$1 WHERE id=$2", [
    ANALYTICS_ORGANIZATIONS.private,
    ANALYTICS_DEALS.negativeCycle.id,
  ]);
  await client.query("UPDATE deals SET lost_reason=$1 WHERE id=$2", [
    ANALYTICS_LEGACY_LOSS,
    ANALYTICS_DEALS.lost.id,
  ]);
  const leadFixtures = [
    ["linked", ANALYTICS_DEALS.recorded.id, true],
    ["secondLink", ANALYTICS_DEALS.recorded.id, true],
    ["pending", null, false],
    ["archived", null, true],
    ["restricted", ANALYTICS_DEALS.restricted.id, true],
    ["hidden", ANALYTICS_DEALS.recorded.id, true],
    ["old", null, false],
  ];
  for (const [key, dealId, archived] of leadFixtures) {
    await client.query(
      `INSERT INTO leads(id,title,owner_id,visibility_level,created_at,archived_at,converted_deal_id)
       VALUES($1,$2,$3,'owner',transaction_timestamp() - $4::interval,
              CASE WHEN $5::boolean THEN transaction_timestamp() END,$6)`,
      [
        ANALYTICS_LEADS[key],
        `CI Analytics lead ${key}`,
        key === "hidden" ? otherOwnerId : a.actorId,
        key === "old" ? "60 days" : "4 days",
        archived,
        dealId,
      ],
    );
  }
}

async function seedOnHostedRunner() {
  assert.equal(process.env.GITHUB_ACTIONS, "true", "Requires the disposable hosted runner");
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.NODE_ENV, "production");
  const admission = spawnSync(
    "python3",
    [fileURLToPath(new URL("./delivery/browser_smoke_environment.py", import.meta.url))],
    { env: process.env, stdio: "inherit", timeout: 5000 },
  );
  assert.equal(admission.status, 0, "Disposable environment admission");
  assert.equal(admission.error, undefined);

  const { db, pool } = await import("../src/db/client.ts");
  const { createBetterAuth } = await import("../src/features/auth/better/auth.ts");
  let client;
  try {
    const auth = createBetterAuth(db);
    const passwordHash = await (await auth.$context).password.hash(ANALYTICS_BROWSER.password);
    client = await pool.connect();
    await client.query(
      "BEGIN; SET LOCAL statement_timeout='5000ms'; SET LOCAL lock_timeout='2000ms'",
    );
    await seedAnalyticsBrowserFixtures(client, {
      passwordHash,
      groupId: id(504),
      otherOwnerId: id(505),
    });
    await client.query("COMMIT");
  } catch (error) {
    if (client) await client.query("ROLLBACK");
    throw error;
  } finally {
    client?.release();
    await pool.end();
  }
}

if (import.meta.main) await seedOnHostedRunner();
