import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// This pack runs serially after the original nine smoke journeys. Its 6821xx/6822xx/6823xx
// fixture IDs are independent of the appearance, delay and history packs. Each pack must restore
// permission502 before handing the seeded actor to another pack. This pack owns its Pool; it
// never imports/ends the application DB pool, starts a worker, or admits a live workflow run.
const fixture = {
  user: "00000000-0000-4000-8000-000000000501",
  permission: "00000000-0000-4000-8000-000000000502",
  pipeline: "00000000-0000-4000-8000-000000000503",
  group: "00000000-0000-4000-8000-000000000504",
};
const profiles = [
  {
    name: "draft-simulation-en-desktop",
    locale: "en",
    tag: "EN",
    suffix: "1",
    failed: false,
    viewport: { width: 1280, height: 900 },
  },
  {
    name: "draft-simulation-fa-mobile",
    locale: "fa",
    tag: "FA",
    suffix: "2",
    failed: false,
    viewport: { width: 390, height: 844 },
  },
  {
    name: "draft-simulation-en-archived-deal",
    locale: "en",
    tag: "FAILURE",
    suffix: "3",
    failed: true,
    viewport: { width: 1280, height: 900 },
  },
].map((profile) => ({
  ...profile,
  workflowId: `00000000-0000-4000-8000-000000682${profile.suffix}01`,
  dealId: `00000000-0000-4000-8000-000000682${profile.suffix}02`,
  savedName: `CI draft smoke ${profile.tag} saved workflow`,
  unsavedName: `CI draft smoke ${profile.tag} unsaved workflow`,
  unsavedStep: `CI draft smoke ${profile.tag} unsaved trigger`,
  dealName: `CI draft smoke ${profile.tag} selected deal`,
  privateSubject: `DRAFT_SMOKE_${profile.tag}_CONFIGURATION_NOT_FOR_RESULTS`,
}));
const nodeIds = { start: "draft682Start", read: "draft682Read", task: "draft682Task" };
const globalRelations = [
  "public.activities",
  "public.activity_guests",
  "public.activity_participants",
  "public.notifications",
  "public.activity_reminder_intents",
  "public.activity_types",
  "public.deals",
  "public.custom_field_defs",
  "public.workflows",
  "public.workflow_versions",
  "public.workflow_runs",
  "public.workflow_steps",
  "public.workflow_run_failures",
];
const queueRelations = ["pgboss.job", "pgboss.queue", "pgboss.schedule"];
const maximumSnapshotRows = 5000;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
function caseDirectory(profile) {
  return new URL(`../test-results/browser-smoke/${profile.name}/`, import.meta.url);
}
function writeJson(profile, name, value) {
  const directory = caseDirectory(profile);
  mkdirSync(directory, { recursive: true });
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(new URL(name, directory), bytes, { flag: "wx" });
  return { file: name, bytes: Buffer.byteLength(bytes), sha256: sha256(bytes) };
}
function admittedProfile() {
  if (
    process.env.GITHUB_ACTIONS !== "true" ||
    process.env.CI !== "true" ||
    process.env.NODE_ENV !== "production"
  ) {
    throw new Error("Draft browser fixtures require the isolated production-mode GitHub runner");
  }
  const admission = spawnSync(
    "python3",
    [fileURLToPath(new URL("./delivery/browser_smoke_environment.py", import.meta.url))],
    { env: process.env, stdio: "inherit", timeout: 5000 },
  );
  if (admission.error || admission.status !== 0)
    throw new Error("Draft browser fixture environment was not admitted");
}
function definition(profile) {
  return {
    schemaVersion: 1,
    nodes: [
      {
        id: nodeIds.start,
        type: "trigger.manual",
        version: 1,
        name: "CI saved draft trigger",
        nameMode: "custom",
        config: {},
      },
      {
        id: nodeIds.read,
        type: "record.read",
        version: 1,
        name: "CI saved draft read",
        nameMode: "custom",
        config: {
          entity: "deal",
          recordId: { kind: "reference", nodeId: nodeIds.start, path: ["recordId"] },
        },
      },
      {
        id: nodeIds.task,
        type: "activity.create",
        version: 1,
        name: "CI saved draft task",
        nameMode: "custom",
        config: {
          subject: { kind: "value", value: profile.privateSubject },
          dealId: { kind: "reference", nodeId: nodeIds.read, path: ["id"] },
        },
      },
    ],
    edges: [
      { from: nodeIds.start, to: nodeIds.read, port: "next" },
      { from: nodeIds.read, to: nodeIds.task, port: "next" },
    ],
  };
}
async function transaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        "Owned browser fixture transaction could not roll back",
      );
    }
    throw error;
  } finally {
    client.release();
  }
}
async function prepareFixtures(pool, permissions) {
  return transaction(pool, async (client) => {
    const actor = await client.query(
      "SELECT id FROM users WHERE id=$1 AND email='browser@example.invalid' AND is_admin=false AND is_active=true AND permission_set_id=$2 AND primary_visibility_group_id=$3",
      [fixture.user, fixture.permission, fixture.group],
    );
    assert.equal(
      actor.rowCount,
      1,
      "The exact synthetic browser actor must own this fixture scope",
    );
    const permission = await client.query(
      "SELECT flags FROM permission_sets WHERE id=$1 AND name='CI browser permissions' FOR UPDATE",
      [fixture.permission],
    );
    assert.equal(permission.rowCount, 1, "The seeded permission row is required");
    const original = permission.rows[0].flags;
    assert.ok(
      original !== null && typeof original === "object" && !Array.isArray(original),
      "Seeded flags must be a map",
    );
    assert.ok(
      original["workflow.view"] === true && original["activity.create"] === true,
      "Existing browser grants must remain present",
    );
    assert.ok(
      original["workflow.edit"] === false && original["workflow.run"] === false,
      "A prior pack must restore its temporary workflow grants",
    );
    const granted = { ...original, "workflow.edit": true, "workflow.run": true };
    const task = await client.query(
      "SELECT id,is_system,archived_at FROM activity_types WHERE key='task'",
    );
    assert.equal(
      task.rowCount,
      1,
      "Canonical migration0007 must supply Task; do not override another pack's metadata",
    );
    assert.ok(
      task.rows[0].is_system === true && task.rows[0].archived_at === null,
      "Canonical Task must be active",
    );
    const stage = await client.query(
      "SELECT id FROM stages WHERE pipeline_id=$1 AND name='CI New' ORDER BY id",
      [fixture.pipeline],
    );
    assert.equal(stage.rowCount, 1, "The canonical browser stage is required");
    const collisions = await client.query(
      "SELECT (SELECT count(*) FROM workflows WHERE id=ANY($1::uuid[]))::int AS workflows,(SELECT count(*) FROM deals WHERE id=ANY($2::uuid[]))::int AS deals",
      [profiles.map((profile) => profile.workflowId), profiles.map((profile) => profile.dealId)],
    );
    assert.deepEqual(
      collisions.rows[0],
      { workflows: 0, deals: 0 },
      "Never overwrite an existing fixture namespace",
    );
    // Capture ownership before the write so even an uncertain COMMIT acknowledgement can
    // restore exactly our flags, or confirm that the transaction left the original flags intact.
    permissions.original = original;
    permissions.granted = granted;
    await client.query("UPDATE permission_sets SET flags=$2::jsonb WHERE id=$1", [
      fixture.permission,
      JSON.stringify(granted),
    ]);
    for (const profile of profiles) {
      await client.query(
        "INSERT INTO workflows(id,owner_id,name,revision,draft,published_number,active) VALUES($1,$2,$3,1,$4::jsonb,NULL,false)",
        [profile.workflowId, fixture.user, profile.savedName, JSON.stringify(definition(profile))],
      );
      await client.query(
        "INSERT INTO deals(id,title,pipeline_id,stage_id,owner_id,visibility_level,value,currency,expected_close_date) VALUES($1,$2,$3,$4,$5,'owner',682123.45,'EUR','2099-06-17')",
        [profile.dealId, profile.dealName, fixture.pipeline, stage.rows[0].id, fixture.user],
      );
    }
    return { original, granted };
  });
}
async function restoreFlags(pool, permissions) {
  await transaction(pool, async (client) => {
    const current = await client.query(
      "SELECT flags=$2::jsonb AS original,flags=$3::jsonb AS granted FROM permission_sets WHERE id=$1 AND name='CI browser permissions' FOR UPDATE",
      [
        fixture.permission,
        JSON.stringify(permissions.original),
        JSON.stringify(permissions.granted),
      ],
    );
    assert.equal(current.rowCount, 1, "The seeded permission owner must remain present");
    if (current.rows[0].original) return;
    assert.equal(current.rows[0].granted, true, "Do not overwrite a different permission cut");
    const restored = await client.query(
      "UPDATE permission_sets SET flags=$2::jsonb WHERE id=$1 AND flags=$3::jsonb RETURNING id",
      [
        fixture.permission,
        JSON.stringify(permissions.original),
        JSON.stringify(permissions.granted),
      ],
    );
    assert.equal(
      restored.rowCount,
      1,
      "Restore only this pack's unchanged temporary permission cut",
    );
  });
}
async function relationSnapshot(pool, relation, optional = false) {
  // Relation names come only from the fixed allowlists above, never environment or UI input.
  const present = await pool.query("SELECT to_regclass($1)::text AS relation", [relation]);
  if (present.rows[0].relation === null) {
    assert.equal(optional, true, "A required canonical business table is absent");
    return { present: false };
  }
  const rows = await pool.query(
    `SELECT to_jsonb(t) AS value FROM ${relation} AS t ORDER BY to_jsonb(t)::text LIMIT ${maximumSnapshotRows + 1}`,
  );
  assert.ok(
    rows.rowCount <= maximumSnapshotRows,
    "Disposable browser rowset exceeded its finite snapshot bound",
  );
  // Only count/digest leave this function. Do not serialize notification/queue payloads.
  return {
    present: true,
    count: rows.rowCount,
    sha256: sha256(JSON.stringify(rows.rows.map((row) => row.value))),
  };
}
async function databaseSnapshot(pool, profile) {
  const workflow = await pool.query(
    "SELECT to_jsonb(w) AS value FROM workflows w WHERE id=$1 AND owner_id=$2",
    [profile.workflowId, fixture.user],
  );
  const deal = await pool.query(
    "SELECT to_jsonb(d) AS value FROM deals d WHERE id=$1 AND owner_id=$2",
    [profile.dealId, fixture.user],
  );
  const w = workflow.rows[0]?.value;
  const d = deal.rows[0]?.value;
  const counts = await pool.query(
    "SELECT (SELECT count(*) FROM workflow_versions WHERE workflow_id=$1)::int AS versions,(SELECT count(*) FROM workflow_runs WHERE workflow_id=$1)::int AS runs,(SELECT count(*) FROM workflow_steps s JOIN workflow_runs r ON r.id=s.run_id WHERE r.workflow_id=$1)::int AS steps,(SELECT count(*) FROM workflow_run_failures f JOIN workflow_runs r ON r.id=f.run_id WHERE r.workflow_id=$1)::int AS failures,(SELECT count(*) FROM activities WHERE deal_id=$2)::int AS linked_activities",
    [profile.workflowId, profile.dealId],
  );
  const global = {};
  for (const relation of globalRelations) global[relation] = await relationSnapshot(pool, relation);
  for (const relation of queueRelations)
    global[relation] = await relationSnapshot(pool, relation, true);
  return {
    ownWorkflow:
      w === undefined
        ? { present: false, ...counts.rows[0] }
        : {
            present: true,
            name: w.name,
            revision: w.revision,
            active: w.active,
            publishedNumber: w.published_number,
            archivedAt: w.archived_at,
            savedStartName: w.draft.nodes.find((node) => node.id === nodeIds.start)?.name,
            draftSha256: sha256(JSON.stringify(w.draft)),
            rowSha256: sha256(JSON.stringify(w)),
            ...counts.rows[0],
          },
    ownDeal:
      d === undefined
        ? { present: false }
        : { present: true, archived: d.archived_at !== null, rowSha256: sha256(JSON.stringify(d)) },
    global,
  };
}
function assertFixtureBaseline(snapshot, profile) {
  const workflow = snapshot.ownWorkflow;
  assert.equal(workflow.present, true, "Owned workflow must remain present");
  assert.equal(workflow.name, profile.savedName);
  assert.equal(workflow.revision, 1);
  assert.equal(workflow.active, false);
  assert.equal(workflow.publishedNumber, null);
  assert.equal(workflow.archivedAt, null);
  assert.equal(workflow.savedStartName, "CI saved draft trigger");
  for (const name of ["versions", "runs", "steps", "failures", "linked_activities"])
    assert.equal(workflow[name], 0, "A fixture must begin without durable execution rows");
  assert.equal(snapshot.ownDeal.present, true, "Owned selected deal must remain present");
  assert.equal(snapshot.ownDeal.archived, profile.failed);
}
async function captureFailureSnapshot(pool, profile) {
  if (profile === undefined) return "not-started";
  try {
    writeJson(profile, "db-after-failure.json", await databaseSnapshot(pool, profile));
    return "written";
  } catch {
    return "unavailable";
  }
}
async function cleanupFixtures(pool) {
  await transaction(pool, async (client) => {
    for (const profile of profiles) {
      const workflow = await client.query(
        "DELETE FROM workflows w WHERE id=$1 AND owner_id=$2 AND name=$3 AND draft=$4::jsonb AND revision=1 AND active=false AND published_number IS NULL AND archived_at IS NULL AND NOT EXISTS(SELECT 1 FROM workflow_versions v WHERE v.workflow_id=w.id) AND NOT EXISTS(SELECT 1 FROM workflow_runs r WHERE r.workflow_id=w.id) RETURNING id",
        [profile.workflowId, fixture.user, profile.savedName, JSON.stringify(definition(profile))],
      );
      assert.equal(workflow.rowCount, 1, "Do not tear down a workflow whose durable state changed");
      const deal = await client.query(
        "DELETE FROM deals d WHERE id=$1 AND owner_id=$2 AND title=$3 AND pipeline_id=$4 AND deleted_at IS NULL AND (archived_at IS NOT NULL)=$5 AND NOT EXISTS(SELECT 1 FROM activities a WHERE a.deal_id=d.id) RETURNING id",
        [profile.dealId, fixture.user, profile.dealName, fixture.pipeline, profile.failed],
      );
      assert.equal(
        deal.rowCount,
        1,
        "Do not tear down a deal with changed ownership or surviving activities",
      );
    }
  });
}
function safeResultText(text, profile) {
  for (const hidden of [
    profile.privateSubject,
    profile.workflowId,
    profile.dealId,
    fixture.user,
    ...Object.values(nodeIds),
    "682123.45",
    "2099-06-17",
  ]) {
    assert.equal(
      text.includes(hidden),
      false,
      "Result disclosed a configuration value, identifier or extra CRM value",
    );
  }
  assert.equal(
    /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i.test(text),
    false,
    "Result must omit generated task and run identities",
  );
  assert.equal(
    /\b[a-f0-9]{64}\b/i.test(text),
    false,
    "Opaque definition digests must not become visible product copy",
  );
}
function nativeSubmission(page, origin, profile) {
  return page.waitForResponse((response) => {
    const request = response.request();
    return (
      request.method() === "POST" &&
      new URL(response.url()).origin === origin &&
      typeof request.headers()["next-action"] === "string" &&
      (request.postData() ?? "").includes(profile.workflowId)
    );
  });
}
async function captureEditor(page, profile, copy, name) {
  await name.waitFor();
  const canvas = page.getByRole("region", { name: copy.canvas, exact: true });
  await canvas.waitFor();
  const directory = caseDirectory(profile);
  mkdirSync(directory, { recursive: true });
  async function screenshot(file) {
    const path = new URL(file, directory);
    assert.equal(existsSync(path), false, "Never overwrite a native editor screenshot");
    await page.screenshot({ path: fileURLToPath(path), animations: "disabled" });
    return { file, sha256: sha256(readFileSync(path)) };
  }
  const editor = await screenshot("editor.png");
  const add = canvas.getByRole("button", { name: /Add a step after CI saved draft task/ });
  await add.click();
  const picker = page.getByRole("dialog", { name: copy.selectAction, exact: true });
  await picker.getByRole("button", { name: copy.createRecord, exact: true }).waitFor();
  const iterator = picker.getByRole("button", { name: copy.iterator, exact: true });
  await iterator.waitFor();
  assert.equal(await iterator.isEnabled(), true);
  assert.equal(await canvas.locator(".react-flow__node.selected").count(), 0);
  const palette = await screenshot("action-picker.png");
  await picker.getByRole("button", { name: copy.close, exact: true }).click();
  await picker.waitFor({ state: "hidden" });
  await add.waitFor();
  return [editor, palette];
}
async function exerciseDraft(page, pool, profile, copy, login, origin) {
  // login() asserts an English board. Set FA only after that real login, then navigate freshly.
  await login(page);
  if (profile.locale !== "en") {
    await page
      .context()
      .addCookies([{ name: "warpdrive_locale", value: profile.locale, url: origin }]);
  }
  await page.goto(`/workflows/${profile.workflowId}`);
  assert.equal(await page.locator("html").getAttribute("lang"), profile.locale);
  assert.equal(
    await page.locator("html").getAttribute("dir"),
    profile.locale === "fa" ? "rtl" : "ltr",
  );
  const name = page.getByRole("textbox", { name: copy.name, exact: true });
  const step = page.getByRole("textbox", { name: copy.stepName, exact: true });
  const editorImages = profile.tag === "EN" ? await captureEditor(page, profile, copy, name) : [];
  await name.fill(profile.unsavedName);
  await page
    .getByRole("navigation", { name: copy.steps, exact: true })
    .getByRole("button", { name: /CI saved draft trigger/ })
    .press("Enter");
  await step.fill(profile.unsavedStep);
  await page.getByText(copy.unsaved, { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: copy.save, exact: true }).isEnabled(), true);
  const opener = page.getByRole("button", { name: copy.workflowOptions, exact: true });
  await opener.click();
  const menu = page.getByRole("menu");
  assert.equal(
    await menu.getByRole("menuitem", { name: copy.simulation, exact: true }).isDisabled(),
    true,
  );
  assert.equal(
    await menu.getByRole("menuitem", { name: copy.live, exact: true }).isDisabled(),
    true,
  );
  await menu.getByRole("menuitem", { name: copy.draftSimulation, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: copy.draftSimulation, exact: true });
  await dialog.getByText(profile.unsavedName, { exact: true }).waitFor();
  await dialog.getByRole("textbox", { name: copy.search, exact: true }).fill(profile.dealName);
  await dialog.getByRole("combobox", { name: copy.deal, exact: true }).click();
  await page.getByRole("option", { name: profile.dealName, exact: true }).click();
  if (profile.failed) {
    const archived = await pool.query(
      "UPDATE deals SET archived_at=clock_timestamp() WHERE id=$1 AND owner_id=$2 AND title=$3 AND archived_at IS NULL RETURNING id",
      [profile.dealId, fixture.user, profile.dealName],
    );
    assert.equal(
      archived.rowCount,
      1,
      "Archive only this already selected owned deal before the baseline",
    );
  }
  const before = await databaseSnapshot(pool, profile);
  const beforeFile = writeJson(profile, "db-before.json", before);
  assertFixtureBaseline(before, profile);
  const [response] = await Promise.all([
    nativeSubmission(page, origin, profile),
    dialog.getByRole("button", { name: copy.confirmSimulation, exact: true }).click(),
  ]);
  assert.equal(response.status(), 200, "The real same-origin server action must return normally");
  const body = response.request().postData() ?? "";
  const action = {
    sameOrigin: true,
    nextAction: true,
    status: response.status(),
    workflowIncluded: body.includes(profile.workflowId),
    selectedRecordIncluded: body.includes(profile.dealId),
    unsavedStepIncluded: body.includes(profile.unsavedStep),
  };
  assert.ok(
    action.workflowIncluded && action.selectedRecordIncluded && action.unsavedStepIncluded,
    "The native action must carry the actual unsaved graph and selected record",
  );
  // Never write the body, action identifier, CSRF argument, cookies, credentials or environment.
  const results = dialog.getByRole("region", { name: copy.draftSimulationResults, exact: true });
  await results.waitFor();
  const status = await results.getByRole("status").innerText();
  assert.equal(status, profile.failed ? copy.draftSimulationFailed : copy.draftSimulationCompleted);
  assert.equal(
    await results.getByText(copy.status.succeeded, { exact: true }).count(),
    profile.failed ? 2 : 3,
  );
  assert.equal(
    await results.getByText(copy.status.failed, { exact: true }).count(),
    profile.failed ? 1 : 0,
  );
  assert.equal(
    await dialog.getByRole("alert").count(),
    0,
    "A contained task failure must remain a redacted step receipt, not a transport error",
  );
  const rows = results.locator("ol > li");
  assert.equal(
    await rows.count(),
    3,
    "The manual, read and canonical task profiles must all be reached",
  );
  assert.ok((await rows.nth(0).innerText()).includes(profile.unsavedStep));
  assert.ok((await rows.nth(2).innerText()).includes("CI saved draft task"));
  safeResultText(await results.innerText(), profile);
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    "Workflow page must fit the viewport horizontally",
  );
  await results.scrollIntoViewIfNeeded();
  const box = await dialog.boundingBox();
  assert.ok(
    box !== null && box.x >= 0 && box.x + box.width <= profile.viewport.width + 1,
    "Draft dialog must fit the native viewport",
  );
  const image = new URL("result.png", caseDirectory(profile));
  assert.equal(existsSync(image), false, "Never overwrite an earlier native screenshot");
  await page.screenshot({ path: fileURLToPath(image), fullPage: true });
  const screenshot = { file: "result.png", sha256: sha256(readFileSync(image)) };
  const afterSimulation = await databaseSnapshot(pool, profile);
  const afterFile = writeJson(profile, "db-after-simulation.json", afterSimulation);
  assert.deepEqual(
    afterSimulation,
    before,
    "Transient native simulation must leave every observed durable rowset unchanged",
  );
  const dom = {
    language: profile.locale,
    direction: profile.locale === "fa" ? "rtl" : "ltr",
    viewport: profile.viewport,
    outcome: profile.failed ? "failed" : "completed",
    rowText: await rows.allInnerTexts(),
    status,
    extraValuesOmitted: true,
    action,
  };
  await dialog.getByRole("button", { name: copy.cancel, exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await page.waitForFunction(
    (button) => button !== null && document.activeElement === button,
    await opener.elementHandle(),
  );
  assert.equal(await name.inputValue(), profile.unsavedName);
  assert.equal(await step.inputValue(), profile.unsavedStep);
  await page.getByRole("tab", { name: copy.runs, exact: true }).click();
  const history = page.getByRole("region", { name: copy.runs, exact: true });
  await history.getByRole("heading", { name: copy.historyEmpty, exact: true }).waitFor();
  const afterHistory = await databaseSnapshot(pool, profile);
  const historyFile = writeJson(profile, "db-after-history.json", afterHistory);
  assert.deepEqual(
    afterHistory,
    before,
    "The normal history read must remain empty without materializing a run",
  );
  return {
    dom,
    before,
    afterSimulation,
    afterHistory,
    files: [beforeFile, afterFile, historyFile, screenshot, ...editorImages],
    historyEmpty: true,
    focusReturned: true,
  };
}

function combinedFailure(primary, cleanupErrors) {
  const errors = primary === undefined ? cleanupErrors : [primary, ...cleanupErrors];
  if (errors.length === 0) return undefined;
  if (errors.length === 1) return errors[0];
  return new AggregateError(errors, "Draft smoke or owned fixture cleanup failed");
}
async function finalizeFixtures(
  pool,
  permissions,
  passed,
  prepared,
  primary,
  diagnostic,
  poolFailed,
) {
  const cleanupErrors = [];
  let restored = false;
  let cleanupAttempted = false;
  let cleaned = false;
  let ended = false;
  try {
    if (permissions.original !== undefined) {
      await restoreFlags(pool, permissions);
      restored = true;
    }
  } catch (error) {
    cleanupErrors.push(error);
  }
  if (primary === undefined && cleanupErrors.length === 0 && restored) {
    cleanupAttempted = true;
    try {
      await cleanupFixtures(pool);
      cleaned = true;
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  try {
    await pool.end();
    ended = true;
  } catch (error) {
    cleanupErrors.push(error);
  }
  if (poolFailed())
    cleanupErrors.push(new Error("The owned fixture pool reported an idle connection failure"));
  const failure = combinedFailure(primary, cleanupErrors);
  const finalizer = {
    passed,
    total: profiles.length,
    fixtureCommitAcknowledged: prepared,
    temporaryGrantAttempted: permissions.original !== undefined,
    temporaryFlagsRestored: restored,
    ownedRowsCleanupAttempted: cleanupAttempted,
    ownedRowsCleaned: cleaned,
    ownedRowsCleanupSkippedAfterFailure: failure !== undefined && !cleanupAttempted,
    ownedPoolEnded: ended,
    diagnosticSnapshot: diagnostic,
    failed: failure !== undefined,
  };
  for (const profile of profiles) writeJson(profile, "fixture-finalizer.json", finalizer);
  console.log(`draft-simulation-fixtures: ${JSON.stringify(finalizer)}`);
  return { failure, restored, cleaned, ended };
}

export async function runWorkflowDraftSimulationBrowserSmoke({ journey, login, catalog, origin }) {
  admittedProfile();
  assert.equal(
    origin,
    "https://127.0.0.1:3443",
    "Only the admitted loopback browser origin is supported",
  );
  // Import effective environment and pg only after both profile and Python admission pass.
  const { env } = await import("../src/config/env.ts");
  assert.ok(
    env.DATABASE_URL === process.env.DATABASE_URL,
    "Effective database target changed after admission",
  );
  const { Pool } = await import("pg");
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: 2,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 3000,
    query_timeout: 5000,
    options:
      "-c statement_timeout=5000 -c lock_timeout=2000 -c idle_in_transaction_session_timeout=5000",
    application_name: "browser-draft-simulation-fixtures",
  });
  let brokenPool = false;
  pool.on("error", () => {
    brokenPool = true;
  });
  const permissions = {};
  let prepared = false;
  let failure;
  let finalizer;
  let currentProfile;
  let diagnostic = "not-needed";
  const passed = [];
  try {
    await prepareFixtures(pool, permissions);
    prepared = true;
    for (const profile of profiles) {
      currentProfile = profile;
      assert.equal(brokenPool, false, "The owned fixture pool reported an idle connection failure");
      const copy = catalog(`src/features/workflows/messages/workflows.${profile.locale}.json`);
      /** @type {{ value: Awaited<ReturnType<typeof exerciseDraft>> | undefined }} */
      const observed = { value: undefined };
      // All contexts begin in EN for login(); the FA exercise changes its own locale afterward.
      await journey(
        profile.name,
        "en",
        async (page) => {
          observed.value = await exerciseDraft(page, pool, profile, copy, login, origin);
        },
        profile.viewport,
      );
      assert.ok(
        observed.value !== undefined,
        "Native observation is required before declaring a journey successful",
      );
      const observation = observed.value;
      const success = {
        case: profile.name,
        status: "passed",
        source: "actual Chromium and native server action",
        authority:
          "synthetic non-admin owner; only workflow.edit and workflow.run are added temporarily",
        databaseAdmission: "isolated production GitHub profile plus browser_smoke_environment.py",
        pool: { owned: true, max: 2, statementTimeoutMs: 5000 },
        ...observation,
        limits:
          "Sample-trigger generation, live runs, provider delivery, human accessibility, included-main and release acceptance are outside this journey.",
      };
      const successFile = writeJson(profile, "SUCCESS.json", success);
      console.log(`draft-simulation-evidence: ${JSON.stringify({ ...success, successFile })}`);
      passed.push(profile.name);
    }
  } catch (error) {
    failure = error;
    diagnostic = await captureFailureSnapshot(pool, currentProfile);
    // Leave owned rows intact after failure. Existing journey() preserves its normal error trace.
  } finally {
    finalizer = await finalizeFixtures(
      pool,
      permissions,
      passed,
      prepared,
      failure,
      diagnostic,
      () => brokenPool,
    );
  }
  if (finalizer.failure !== undefined) throw finalizer.failure;
  assert.ok(
    finalizer.restored && finalizer.cleaned && finalizer.ended && passed.length === profiles.length,
    "Every owned fixture gate must finish",
  );
}
