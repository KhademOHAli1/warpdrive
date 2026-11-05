import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { prepareLocaleThroughUi } from "./browser-locale-preferences.mjs";
import { createPreferenceProbe } from "./browser-workflow-preference-actions.mjs";

// Admit the connection actually used before importing either database or browser clients.
if (
  process.env.GITHUB_ACTIONS !== "true" ||
  process.env.CI !== "true" ||
  process.env.NODE_ENV !== "production"
) {
  throw new Error(
    "Workflow preference validation requires the disposable production GitHub runner",
  );
}
const admission = spawnSync(
  "python3",
  [fileURLToPath(new URL("./delivery/browser_smoke_environment.py", import.meta.url))],
  {
    env: process.env,
    stdio: "inherit",
  },
);
assert.equal(admission.status, 0);
assert.equal(admission.error, undefined);
const { chromium } = await import("../tools/browser-smoke/node_modules/playwright/index.mjs");
const { default: pg } = await import("pg");
const origin = "https://127.0.0.1:3443";
const actor = "00000000-0000-4000-8000-000000000501";
const sentinel = "00000000-0000-4000-8000-000000000505";
const evidence = new URL("../test-results/browser-smoke/workflow-preferences/", import.meta.url);
mkdirSync(evidence, { recursive: true });
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
  connectionTimeoutMillis: 5000,
  query_timeout: 5000,
  statement_timeout: 5000,
});
const report = {
  state: "RUNNING",
  revision: process.env.APP_COMMIT,
  buildId: readFileSync(new URL("../.next/BUILD_ID", import.meta.url), "utf8").trim(),
  criteria: "#867 AC1: ordered persistence, acknowledged rollback and rapid preference recovery",
  limits:
    "Disposable native password login/actions and synthetic preference rows only. No preference relocation, provider effects, human AT, installed, main or release acceptance.",
  journeys: [],
  nativeLogins: [],
  localePreparations: [],
  unhandledErrors: [],
  cleanup: {
    browserClosed: false,
    actorPreferencesRestored: false,
    databasePoolClosed: false,
    sessionCacheCleared: false,
  },
};
let browser;
let baseline;
const nativeSessions = new Map();
/** @type {{ error?: Error }} */
const failure = {};
const saveReport = () =>
  writeFileSync(new URL("receipt.json", evidence), `${JSON.stringify(report, null, 2)}\n`);
process.on("unhandledRejection", () => {
  failure.error ??= new Error("Unhandled asynchronous workflow preference harness rejection");
  report.unhandledErrors.push(failure.error.message);
  report.state = "FAIL";
  process.exitCode = 1;
  saveReport();
});
const catalog = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));

function asError(value) {
  return value instanceof Error
    ? value
    : new Error("Workflow preference validation failed with a non-Error", { cause: value });
}

async function snapshot() {
  const { rows } = await pool.query(
    "SELECT user_id, timezone, density, ui, updated_at::text AS updated_at FROM user_preferences ORDER BY user_id",
  );
  const own = rows.find((row) => row.user_id === actor);
  assert.ok(own, "Seeded actor preference row exists");
  assert.ok(
    rows.some((row) => row.user_id === sentinel),
    "Other-actor preservation is nonvacuous",
  );
  return { own, other: rows.filter((row) => row.user_id !== actor) };
}

/** @param {Record<string, unknown> | null} [changes] */
function verify(before, after, changes = null) {
  assert.deepEqual(after.other, before.other, "Other actors retain every preference and timestamp");
  if (changes === null) {
    assert.deepEqual(after.own, before.own, "Denied action retains the complete persisted row");
    return;
  }
  const expected = structuredClone(before.own);
  Object.assign(expected.ui, changes);
  delete expected.updated_at;
  const actual = { ...after.own };
  delete actual.updated_at;
  assert.deepEqual(actual, expected, "Only the requested UI keys change");
}

function checked(page, label) {
  return page.getByRole("switch", { name: label, exact: true });
}

async function state(page, control, expected) {
  await control.waitFor({ state: "visible" });
  await page.waitForFunction(
    ({ label, value }) => {
      const switches = [...document.querySelectorAll('[role="switch"]')];
      const target = switches.find((node) => node.getAttribute("aria-label") === label);
      return target?.getAttribute("aria-checked") === String(value);
    },
    { label: await control.getAttribute("aria-label"), value: expected },
  );
  assert.equal(await control.getAttribute("aria-checked"), String(expected));
}

async function reload(s, values) {
  await s.page.reload();
  await s.page
    .getByRole("heading", { level: 1, name: s.L._hierarchy.workflow, exact: true })
    .waitFor();
  for (const [label, expected] of values) await state(s.page, checked(s.page, label), expected);
}

async function toggle(s, label, kind, value, ok = true) {
  const hold = s.probe.expect({ kind, value, ok });
  await checked(s.page, label).click();
  await hold.reached();
  return hold;
}

async function finish(hold) {
  hold.release();
  await hold.delivered();
}

async function csrf(s, operation) {
  const cookies = (await s.context.cookies(origin)).filter((cookie) => cookie.name === "wd_csrf");
  assert.equal(cookies.length, 1);
  assert.equal(cookies[0].httpOnly, false);
  try {
    await s.context.clearCookies({
      name: cookies[0].name,
      domain: cookies[0].domain,
      path: cookies[0].path,
    });
    return await operation(() => s.context.addCookies(cookies));
  } finally {
    await s.context.addCookies(cookies);
  }
}

async function noErrorAfterPaint(s) {
  await s.page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }),
  );
  assert.equal(await s.page.getByRole("dialog").count(), 0);
}

async function ordering(s, kind, label) {
  const before = await snapshot();
  const initial = before.own.ui[kind === "won" ? "scheduleFollowUpAfterWon" : kind] ?? false;
  const first = await toggle(s, label, kind, !initial);
  const held = await snapshot();
  const key = kind === "won" ? "scheduleFollowUpAfterWon" : kind;
  verify(before, held, { [key]: !initial });
  const second = s.probe.expect({ kind, value: initial, ok: true });
  await checked(s.page, label).click();
  await state(s.page, checked(s.page, label), initial);
  assert.equal(s.probe.actions.length, 1, "Same-key writes wait for the prior acknowledgement");
  await finish(first);
  await second.reached();
  const final = await snapshot();
  verify(held, final, { [key]: initial });
  await finish(second);
  await noErrorAfterPaint(s);
  await reload(s, [[label, initial]]);
  verify(final, await snapshot());
  s.entry.databaseChecks.push({ key, before, firstHeld: held, final, exactActions: 2 });
}

async function latestFailure(s) {
  const key = "usPhoneFormat";
  const label = s.L.interface[key];
  const before = await snapshot();
  const initial = before.own.ui[key] ?? false;
  const first = await toggle(s, label, key, !initial);
  const acknowledged = await snapshot();
  verify(before, acknowledged, { [key]: !initial });
  await csrf(s, async (restore) => {
    const failed = s.probe.expect({ kind: key, value: initial, ok: false });
    await checked(s.page, label).click();
    assert.equal(s.probe.actions.length, 1);
    await finish(first);
    await failed.reached();
    verify(acknowledged, await snapshot());
    await restore();
    await finish(failed);
    const dialog = s.page.getByRole("dialog");
    await dialog.getByRole("heading", { name: s.shell.errors.csrf.title, exact: true }).waitFor();
    await dialog.getByText(s.shell.errors.csrf.body, { exact: true }).waitFor();
    s.entry.errorDialog = await dialog.ariaSnapshot();
    await s.page.screenshot({
      path: fileURLToPath(new URL(`${s.entry.locale}-${s.entry.name}-denied.png`, evidence)),
      fullPage: true,
    });
    await s.page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    await state(s.page, checked(s.page, label), !initial);
  });
  const retry = await toggle(s, label, key, initial);
  const final = await snapshot();
  verify(acknowledged, final, { [key]: initial });
  await finish(retry);
  await reload(s, [[label, initial]]);
  verify(final, await snapshot());
  assert.equal(s.probe.actions.length, 3);
  s.entry.databaseChecks.push({
    key,
    before,
    acknowledged,
    final,
    exactActions: 3,
    rollbackToAcknowledged: true,
  });
}

async function staleFailure(s) {
  const key = "usPhoneFormat";
  const label = s.L.interface[key];
  const before = await snapshot();
  const initial = before.own.ui[key] ?? false;
  await csrf(s, async (restore) => {
    const failed = await toggle(s, label, key, !initial, false);
    verify(before, await snapshot());
    await restore();
    const newer = s.probe.expect({ kind: key, value: initial, ok: true });
    await checked(s.page, label).click();
    assert.equal(s.probe.actions.length, 1);
    await finish(failed);
    await newer.reached();
    await noErrorAfterPaint(s);
    const final = await snapshot();
    verify(before, final, { [key]: initial });
    await finish(newer);
    await noErrorAfterPaint(s);
    await reload(s, [[label, initial]]);
    verify(final, await snapshot());
    s.entry.databaseChecks.push({
      key,
      before,
      final,
      exactActions: 2,
      staleErrorSuppressed: true,
    });
  });
}

async function cumulativeDetails(s) {
  const label = s.L.interface.openDetailsAfterCreate;
  const before = await snapshot();
  const old = before.own.ui.openDetailsAfterCreate ?? {
    leadDeal: false,
    person: false,
    org: false,
  };
  const all = !(old.leadDeal && old.person && old.org);
  const firstValue = { leadDeal: all, person: all, org: all };
  const first = await toggle(s, label, "details", JSON.stringify([all, all, all]));
  const held = await snapshot();
  verify(before, held, { openDetailsAfterCreate: firstValue });
  const secondValue = { ...firstValue, person: !all };
  const second = s.probe.expect({
    kind: "details",
    value: JSON.stringify([all, !all, all]),
    ok: true,
  });
  await checked(s.page, s.L.interface.openDetailsPerson).click();
  assert.equal(s.probe.actions.length, 1, "Cumulative objects serialize together");
  await finish(first);
  await second.reached();
  const final = await snapshot();
  verify(held, final, { openDetailsAfterCreate: secondValue });
  await finish(second);
  await reload(s, [
    [s.L.interface.openDetailsLeadDeal, all],
    [s.L.interface.openDetailsPerson, !all],
    [s.L.interface.openDetailsOrg, all],
    [label, false],
  ]);
  verify(final, await snapshot());
  s.entry.databaseChecks.push({ before, firstHeld: held, final, exactActions: 2 });
}

async function independentKeys(s) {
  const before = await snapshot();
  const sound = !(before.own.ui.winSound ?? false);
  const won = !(before.own.ui.scheduleFollowUpAfterWon ?? false);
  const first = await toggle(s, s.L.interface.winSound, "winSound", sound);
  const firstHeld = await snapshot();
  verify(before, firstHeld, { winSound: sound });
  const second = s.probe.expect({ kind: "won", value: won, ok: true });
  await checked(s.page, s.L.scheduleFollowUpAfterWon).click();
  await state(s.page, checked(s.page, s.L.scheduleFollowUpAfterWon), won);
  await state(s.page, checked(s.page, s.L.interface.winSound), sound);
  assert.equal(
    s.probe.actions.length,
    1,
    "The installed Next router serializes server action dispatch",
  );
  verify(firstHeld, await snapshot());
  await finish(first);
  await second.reached();
  const bothHeld = await snapshot();
  verify(firstHeld, bothHeld, { scheduleFollowUpAfterWon: won });
  await finish(second);
  await reload(s, [
    [s.L.interface.winSound, sound],
    [s.L.scheduleFollowUpAfterWon, won],
  ]);
  verify(bothHeld, await snapshot());
  s.entry.databaseChecks.push({ before, firstHeld, bothHeld, exactActions: 2 });
}

async function prepareBaselineLocale() {
  const context = await browser.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
    serviceWorkers: "block",
    viewport: { width: 1280, height: 900 },
  });
  context.setDefaultTimeout(15000);
  try {
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.origin === origin) return route.continue();
      return route.abort("blockedbyclient");
    });
    await context.routeWebSocket("**/*", (socket) =>
      socket.close({ code: 1008, reason: "No sockets in locale preparation" }),
    );
    const page = await context.newPage();
    await page.goto("/login");
    await page.locator('input[name="email"]').fill("browser@example.invalid");
    await page.locator('input[name="password"]').fill("CI-browser-only-password-2026!");
    await page.locator('button[type="submit"]').click();
    await page.waitForURL((url) => !/^\/(login|auth)(\/|$)/.test(url.pathname));
    const prepared = await prepareLocaleThroughUi(page, origin, "en");
    nativeSessions.set("en", await context.storageState());
    report.localePreparations.push({ locale: "en", ...prepared, baseline: true });
    report.nativeLogins.push({ locale: "en", method: "password", storage: "memory-only" });
  } finally {
    await context.close();
  }
}

async function journey(locale, name, exercise) {
  const viewport = locale === "fa" ? { width: 390, height: 844 } : { width: 1280, height: 900 };
  const entry = {
    locale,
    name,
    viewport,
    databaseChecks: [],
    actions: [],
    browserErrors: [],
    externalRequests: [],
    unexpectedActions: [],
    contextClosed: false,
    sessionReused: nativeSessions.has(locale),
  };
  report.journeys.push(entry);
  const context = await browser.newContext({
    baseURL: origin,
    viewport,
    ignoreHTTPSErrors: true,
    serviceWorkers: "block",
    storageState: structuredClone(nativeSessions.get(locale)),
  });
  context.setDefaultTimeout(15000);
  let probe;
  let page;
  /** @type {Error | undefined} */
  let problem;
  try {
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) {
        entry.externalRequests.push(url.origin);
        return route.abort("blockedbyclient");
      }
      const request = route.request();
      if (
        request.method() === "POST" &&
        request.headers()["next-action"] &&
        url.pathname === "/settings/workflow"
      ) {
        if (probe) return probe.handle(route);
        entry.unexpectedActions.push("Preference action before probe attachment");
        return route.abort("blockedbyclient");
      }
      return route.continue();
    });
    await context.routeWebSocket("**/*", (socket) => {
      entry.externalRequests.push(new URL(socket.url()).origin);
      socket.close({ code: 1008, reason: "No WebSockets in preference validation" });
    });
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    page = await context.newPage();
    page.on("pageerror", (error) => entry.browserErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") entry.browserErrors.push(message.text());
    });
    if (!nativeSessions.has(locale)) {
      await page.goto("/login");
      await page.locator('input[name="email"]').fill("browser@example.invalid");
      await page.locator('input[name="password"]').fill("CI-browser-only-password-2026!");
      await page.locator('button[type="submit"]').click();
      await page.waitForURL((url) => !/^\/(login|auth)(\/|$)/.test(url.pathname));
      entry.localePreparation = await prepareLocaleThroughUi(page, origin, locale);
      report.localePreparations.push({ locale, ...entry.localePreparation });
      nativeSessions.set(locale, await context.storageState());
      report.nativeLogins.push({ locale, method: "password", storage: "memory-only" });
    }
    assert.equal((await page.goto("/settings/workflow")).status(), 200);
    const L = catalog(`src/features/identity/messages/settings.${locale}.json`);
    const shell = catalog(`src/components/shell/messages/shell.${locale}.json`);
    await page
      .getByRole("heading", { level: 1, name: L._hierarchy.workflow, exact: true })
      .waitFor();
    assert.equal(await page.locator("html").getAttribute("lang"), locale);
    assert.equal(await page.locator("html").getAttribute("dir"), locale === "fa" ? "rtl" : "ltr");
    probe = createPreferenceProbe(page, { origin });
    await exercise({ page, context, probe, L, shell, entry });
    await probe.close();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      true,
    );
    entry.actions = probe.actions;
    entry.accessibilitySnapshot = await page.getByRole("main").ariaSnapshot();
    await page.screenshot({
      path: fileURLToPath(new URL(`${locale}-${name}.png`, evidence)),
      fullPage: true,
    });
    await context.tracing.stop();
    await context.unrouteAll({ behavior: "wait" });
    assert.deepEqual(entry.browserErrors, []);
    assert.deepEqual(entry.externalRequests, []);
    assert.deepEqual(entry.unexpectedActions, []);
  } catch (error) {
    entry.passed = false;
    entry.error = error instanceof Error ? error.message : "Unknown validation error";
    if (page)
      await page
        .screenshot({
          path: fileURLToPath(new URL(`${locale}-${name}-failure.png`, evidence)),
          fullPage: true,
        })
        .catch(() => {});
    await context.tracing
      .stop({ path: fileURLToPath(new URL(`${locale}-${name}-trace.zip`, evidence)) })
      .catch(() => {});
    problem = asError(error);
  } finally {
    try {
      await probe?.close();
    } catch (error) {
      problem ??= asError(error);
      entry.passed = false;
    }
    try {
      await context.close();
      entry.contextClosed = true;
    } catch (error) {
      problem ??= asError(error);
      entry.passed = false;
    }
    entry.actions = probe?.actions ?? [];
    saveReport();
  }
  if (problem) throw problem;
  entry.passed = true;
  saveReport();
  console.log(`workflow-preferences-${locale}-${name}: passed`);
}

try {
  const admitted = await pool.query("SELECT id FROM users WHERE id=$1 AND email=$2", [
    actor,
    "browser@example.invalid",
  ]);
  assert.equal(admitted.rowCount, 1, "Only the existing disposable browser actor is admitted");
  browser = await chromium.launch({ headless: true });
  // Establish the first saved locale through the real regional settings control before capturing
  // the raw preference baseline. Later locale journeys take their own snapshots after switching
  // through that same control, so a locale write is never misclassified as a workflow mutation.
  await prepareBaselineLocale();
  baseline = await snapshot();
  for (const locale of ["en", "de", "fa"]) {
    await journey(locale, "flag-ordering", (s) =>
      ordering(s, "usPhoneFormat", s.L.interface.usPhoneFormat),
    );
    await journey(locale, "won-ordering", (s) => ordering(s, "won", s.L.scheduleFollowUpAfterWon));
    await journey(locale, "latest-failure-retry", latestFailure);
    await journey(locale, "stale-denial", staleFailure);
    await journey(locale, "cumulative-details", cumulativeDetails);
    await journey(locale, "cross-key-intents", independentKeys);
  }
  assert.equal(report.nativeLogins.length, 3);
  assert.equal(report.journeys.filter((entry) => entry.sessionReused).length, 15);
  assert.equal(report.journeys.length, 18);
  assert.ok(report.journeys.every((entry) => entry.passed));
  if (failure.error) throw failure.error;
  report.state = "PASS";
} catch (error) {
  failure.error ??= asError(error);
  report.state = "FAIL";
  process.exitCode = 1;
} finally {
  const cleanupFailure = (error) => {
    failure.error ??= asError(error);
    report.state = "FAIL";
    process.exitCode = 1;
  };
  try {
    await browser?.close();
    report.cleanup.browserClosed = true;
  } catch (error) {
    cleanupFailure(error);
  }
  try {
    if (baseline) {
      // Fixture cleanup restores the exact post-setup baseline values/timestamp, including unknown UI keys.
      // This is not an application undo or customer migration capability.
      const restored = await pool.query(
        "UPDATE user_preferences SET timezone=$2,density=$3,ui=$4::jsonb,updated_at=$5::timestamptz WHERE user_id=$1 AND EXISTS(SELECT 1 FROM users WHERE id=$1 AND email=$6)",
        [
          actor,
          baseline.own.timezone,
          baseline.own.density,
          JSON.stringify(baseline.own.ui),
          baseline.own.updated_at,
          "browser@example.invalid",
        ],
      );
      assert.equal(restored.rowCount, 1);
      assert.deepEqual(await snapshot(), baseline);
      report.cleanup.actorPreferencesRestored = true;
    }
  } catch (error) {
    cleanupFailure(error);
  }
  nativeSessions.clear();
  report.cleanup.sessionCacheCleared = true;
  try {
    await pool.end();
    report.cleanup.databasePoolClosed = true;
  } catch (error) {
    cleanupFailure(error);
  }
  report.error = failure.error?.message;
  saveReport();
}
