import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { completeRegionalPreferenceSave } from "./browser-locale-preferences.mjs";

// Admission precedes DB/browser imports. This pack is deliberately production-only and must
// never attach to a developer's local database or browser session.
if (
  process.env.GITHUB_ACTIONS !== "true" ||
  process.env.CI !== "true" ||
  process.env.NODE_ENV !== "production"
) {
  throw new Error("Regional validation requires the disposable production GitHub runner");
}
const admission = spawnSync(
  "python3",
  [fileURLToPath(new URL("./delivery/browser_smoke_environment.py", import.meta.url))],
  { env: process.env, stdio: "inherit" },
);
assert.equal(admission.status, 0, "Disposable environment admission");
assert.equal(admission.error, undefined);

const { chromium } = await import("../tools/browser-smoke/node_modules/playwright/index.mjs");
const { default: pg } = await import("pg");

const origin = "https://127.0.0.1:3443";
const password = "CI-browser-only-password-2026!";
const regionalCookieNames = [
  "warpdrive_locale",
  "warpdrive_calendar",
  "warpdrive_timezone",
  "warpdrive_country",
  "warpdrive_timezone_mode",
  "warpdrive_numbering_system",
];
const evidence = new URL("../test-results/browser-smoke/regional984/", import.meta.url);
mkdirSync(evidence, { recursive: true });

const configs = [
  {
    key: "fa",
    actor: {
      id: "00000000-0000-4000-8000-000000000506",
      email: "regional-fa@example.invalid",
    },
    browserLocale: "fa-IR",
    locale: "fa",
    country: "IR",
    timeZone: "Asia/Tehran",
    calendar: "persian",
    numberingSystem: "arabext",
    alternateCountry: "US",
    viewport: { width: 390, height: 844 },
  },
  {
    key: "de",
    actor: {
      id: "00000000-0000-4000-8000-000000000507",
      email: "regional-de@example.invalid",
    },
    browserLocale: "de-DE",
    locale: "de",
    country: "DE",
    timeZone: "Europe/Berlin",
    calendar: "gregory",
    numberingSystem: "latn",
    alternateCountry: "US",
    viewport: { width: 1280, height: 900 },
  },
  {
    key: "en",
    actor: {
      id: "00000000-0000-4000-8000-000000000508",
      email: "regional-en@example.invalid",
    },
    browserLocale: "en-GB",
    locale: "en",
    country: "GB",
    timeZone: "Europe/London",
    calendar: "gregory",
    numberingSystem: "latn",
    alternateCountry: "US",
    viewport: { width: 1280, height: 900 },
  },
];

const report = {
  state: "RUNNING",
  revision: process.env.APP_COMMIT,
  buildId: readFileSync(new URL("../.next/BUILD_ID", import.meta.url), "utf8").trim(),
  browser: "Chromium",
  criteria:
    "PR984: fresh native-auth browser contexts infer language/country/formats/time zone, persist deliberate regional controls, and retain them in a new context and calendar route",
  limits:
    "Production loopback only; no provider calls, external origins or WebSockets. Three native password logins and three in-memory session reuses. No screen-reader speech, whole-roadmap acceptance, deployment or release qualification.",
  cohorts: {
    existingBaseline: {
      actor: "00000000-0000-4000-8000-000000000501",
      note: "Existing appearance/workflow actor is read-only and must remain unchanged.",
    },
    freshRegional: configs.map(({ key, actor, browserLocale, timeZone }) => ({
      key,
      actor: actor.id,
      browserLocale,
      timeZone,
      preferencesRowBeforeAuth: null,
    })),
  },
  journeys: [],
  nativeLogins: [],
  unhandledErrors: [],
  databaseChecks: [],
  cleanup: { browserClosed: false, databasePoolClosed: false, sessionCacheCleared: false },
};

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
  connectionTimeoutMillis: 5000,
  query_timeout: 5000,
  statement_timeout: 5000,
  options: "-c default_transaction_read_only=on",
});
let browser;
let fatal;
const nativeSessions = new Map();

function writeReport() {
  writeFileSync(new URL("receipt.json", evidence), JSON.stringify(report, null, 2));
}

function asError(error) {
  return error instanceof Error
    ? error
    : new Error("Regional validation failed with a non-Error", { cause: error });
}

process.on("unhandledRejection", (error) => {
  fatal ??= asError(error);
  report.state = "FAIL";
  report.unhandledErrors.push({
    name: error instanceof Error ? error.name : "NonErrorRejection",
    message: error instanceof Error ? error.message : "Unhandled asynchronous browser rejection",
  });
  process.exitCode = 1;
  writeReport();
});

function catalog(path) {
  return JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
}

function settingsMessages(locale) {
  return catalog(`src/features/i18n/messages/${locale}.json`).preferences;
}

function calendarMessages(locale) {
  return catalog(`src/features/activities/messages/calendar.${locale}.json`);
}

async function drainContextRoutes(context) {
  let timer;
  try {
    await Promise.race([
      context.unrouteAll({ behavior: "wait" }),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Owned regional context routes did not drain")),
          10_000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function waitUntil(label, read, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (value) return value;
    } catch (error) {
      lastError = asError(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${label} did not settle${lastError ? `: ${lastError.message}` : ""}`);
}

async function readPreference(userId) {
  const { rows } = await pool.query(
    "SELECT user_id, timezone, density, ui FROM user_preferences WHERE user_id = $1",
    [userId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    user_id: row.user_id,
    timezone: row.timezone,
    density: row.density,
    ui: row.ui ?? {},
  };
}

async function readWitnesses() {
  const regionalIds = configs.map((config) => config.actor.id);
  const { rows } = await pool.query(
    "SELECT user_id, timezone, density, ui FROM user_preferences WHERE user_id NOT IN ($1,$2,$3) ORDER BY user_id",
    regionalIds,
  );
  assert.ok(
    rows.some((row) => row.user_id === "00000000-0000-4000-8000-000000000501"),
    "Existing browser actor is present in the shared baseline",
  );
  assert.ok(
    rows.some((row) => row.user_id === "00000000-0000-4000-8000-000000000505"),
    "Existing sentinel is present in the shared baseline",
  );
  return rows.map((row) => ({
    user_id: row.user_id,
    timezone: row.timezone,
    density: row.density,
    ui: row.ui ?? {},
  }));
}

function expectedPreferences(config, timeZoneMode = "browser", country = config.country) {
  return {
    locale: config.locale,
    calendar: config.calendar,
    timeZone: config.timeZone,
    country,
    timeZoneMode,
    numberingSystem: config.numberingSystem,
  };
}

function assertPreferenceRow(row, config, options = {}) {
  assert.ok(row, `Preference row exists for ${config.key}`);
  const expected = expectedPreferences(
    config,
    options.timeZoneMode ?? "browser",
    options.country ?? config.country,
  );
  assert.equal(row.timezone, config.timeZone, `${config.key} profile time zone`);
  assert.equal(row.density, "comfortable", `${config.key} starts at the seed density`);
  assert.deepEqual(
    row.ui.localePreferences,
    expected,
    `${config.key} saved locale preferences are exact`,
  );
  assert.deepEqual(
    Object.keys(row.ui).sort(),
    ["localePreferences"],
    `${config.key} regional writes do not rewrite unrelated UI keys`,
  );
}

function observePage(context, page, entry) {
  const state = {
    externalRequests: [],
    unexpectedSockets: [],
    actionRequests: [],
    requestFailures: [],
    pageErrors: [],
    consoleErrors: [],
    navigationCancellations: [],
  };

  page.on("requestfailed", (request) => {
    const url = new URL(request.url());
    const failure = request.failure()?.errorText;
    if (url.origin !== origin) return;
    if (
      failure === "net::ERR_ABORTED" &&
      request.method() === "GET" &&
      (request.isNavigationRequest() || request.headers().rsc === "1")
    ) {
      state.navigationCancellations.push({ path: url.pathname, failure });
      return;
    }
    state.requestFailures.push({
      path: url.pathname,
      method: request.method(),
      failure,
    });
  });
  page.on("pageerror", (error) => state.pageErrors.push(error.name));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const location = message.location().url;
    if (location === "" || location.startsWith(origin)) state.consoleErrors.push(message.text());
  });

  const routesReady = Promise.all([
    context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== origin) {
        state.externalRequests.push({
          origin: url.origin,
          path: url.pathname,
          method: request.method(),
        });
        await route.abort("blockedbyclient");
        return;
      }
      if (request.method() === "POST" && request.headers()["next-action"]) {
        state.actionRequests.push({ path: url.pathname, method: request.method() });
      }
      await route.continue();
    }),
    context.routeWebSocket("**/*", (socket) => {
      state.unexpectedSockets.push(new URL(socket.url()).origin);
      return socket.close({ code: 1008, reason: "No sockets in regional validation" });
    }),
  ]);

  return {
    state,
    ready: routesReady,
    verify() {
      entry.network = {
        externalRequests: state.externalRequests,
        unexpectedSockets: state.unexpectedSockets,
        actionRequests: state.actionRequests,
        requestFailures: state.requestFailures,
        pageErrors: state.pageErrors,
        consoleErrors: state.consoleErrors,
        navigationCancellations: state.navigationCancellations,
      };
      assert.deepEqual(state.externalRequests, [], "No external origin requests");
      assert.deepEqual(state.unexpectedSockets, [], "No external WebSockets");
      assert.deepEqual(state.requestFailures, [], "No unexpected same-origin request failures");
      assert.deepEqual(state.pageErrors, [], "No page errors");
      assert.deepEqual(state.consoleErrors, [], "No same-origin console errors");
    },
  };
}

async function assertDocument(page, config) {
  await page.waitForFunction(
    ({ locale, direction }) => {
      return document.documentElement.lang === locale && document.documentElement.dir === direction;
    },
    { locale: config.locale, direction: config.locale === "fa" ? "rtl" : "ltr" },
  );
  assert.equal(await page.locator("html").getAttribute("lang"), config.locale);
  assert.equal(
    await page.locator("html").getAttribute("dir"),
    config.locale === "fa" ? "rtl" : "ltr",
  );
}

async function assertGuestCookies(context, config) {
  const cookies = Object.fromEntries(
    (await context.cookies(origin)).map((cookie) => [cookie.name, cookie.value]),
  );
  const expected = {
    warpdrive_locale: config.locale,
    warpdrive_calendar: config.calendar,
    warpdrive_timezone: config.timeZone,
    warpdrive_country: config.country,
    warpdrive_timezone_mode: "browser",
    warpdrive_numbering_system: config.numberingSystem,
  };
  for (const [name, value] of Object.entries(expected)) {
    assert.equal(cookies[name], value, `Guest bootstrap cookie ${name}`);
  }
  return Object.keys(expected).sort();
}

async function statusPage(page, path) {
  const response = await page.goto(path, { waitUntil: "domcontentloaded" });
  assert.ok(response, `${path} returned a response`);
  assert.equal(response.status(), 200, `${path} status`);
}

async function nativeLogin(page, context, config, entry) {
  await statusPage(page, "/login");
  await page.locator('input[name="email"]').fill(config.actor.email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((url) => !/^\/(login|auth)(\/|$)/.test(url.pathname));
  await page.getByRole("main").waitFor({ state: "visible" });
  await assertDocument(page, config);
  report.nativeLogins.push({
    key: config.key,
    actor: config.actor.id,
    method: "password",
    storage: "memory-only",
  });
  nativeSessions.set(config.key, await context.storageState());
  entry.nativeLogin = true;
}

async function waitForSettingsControls(page, config) {
  const messages = settingsMessages(config.locale);
  const country = page.getByRole("combobox", { name: messages.country, exact: true });
  const zoneSwitch = page.getByRole("switch", { name: messages.browserTimeZone, exact: true });
  await country.waitFor({ state: "visible" });
  await zoneSwitch.waitFor({ state: "visible" });
  return { country, zoneSwitch, messages };
}

async function waitForControlEnabled(locator, label) {
  await waitUntil(`${label} enabled`, async () => !(await locator.isDisabled()));
}

function countryName(locale, country) {
  return new Intl.DisplayNames([locale], { type: "region" }).of(country) ?? country;
}

async function chooseCountry(page, controls, config, country, entry) {
  await waitForControlEnabled(controls.country, `${config.key} country control`);
  await controls.country.click();
  const option = page.getByRole("option", {
    name: countryName(config.locale, country),
    exact: true,
  });
  await option.waitFor({ state: "visible" });
  await completeRegionalPreferenceSave(page, origin, () => option.click());
  await waitUntil(`${config.key} country UI ${country}`, async () => {
    const text = await controls.country.textContent();
    return text?.trim() === countryName(config.locale, country);
  });
  await waitUntil(`${config.key} country database ${country}`, async () => {
    const row = await readPreference(config.actor.id);
    return row?.ui?.localePreferences?.country === country;
  });
  entry.explicitCountryChanges ??= [];
  entry.explicitCountryChanges.push(country);
}

async function exerciseExplicitProfile(page, config, entry) {
  const controls = await waitForSettingsControls(page, config);
  const initial = await readPreference(config.actor.id);
  assert.equal(initial, null, `${config.key} has no saved row before explicit profile action`);

  await waitForControlEnabled(controls.zoneSwitch, `${config.key} browser time zone switch`);
  assert.equal(await controls.zoneSwitch.getAttribute("aria-checked"), "true");
  await completeRegionalPreferenceSave(page, origin, () => controls.zoneSwitch.click());
  await waitUntil(`${config.key} manual time zone switch`, async () => {
    return (await controls.zoneSwitch.getAttribute("aria-checked")) === "false";
  });
  await waitUntil(`${config.key} manual mode database`, async () => {
    const row = await readPreference(config.actor.id);
    return row?.ui?.localePreferences?.timeZoneMode === "manual";
  });
  assertPreferenceRow(await readPreference(config.actor.id), config, { timeZoneMode: "manual" });

  await chooseCountry(page, controls, config, config.alternateCountry, entry);
  await chooseCountry(page, controls, config, config.country, entry);

  await waitForControlEnabled(
    controls.zoneSwitch,
    `${config.key} browser time zone switch restore`,
  );
  await completeRegionalPreferenceSave(page, origin, () => controls.zoneSwitch.click());
  await waitUntil(`${config.key} browser time zone switch`, async () => {
    return (await controls.zoneSwitch.getAttribute("aria-checked")) === "true";
  });
  const row = await waitUntil(`${config.key} final database preferences`, async () => {
    const candidate = await readPreference(config.actor.id);
    try {
      assertPreferenceRow(candidate, config);
      return candidate;
    } catch {
      return false;
    }
  });
  entry.database = { afterExplicitProfile: row };
  assert.equal(
    entry.explicitCountryChanges.join(","),
    `${config.alternateCountry},${config.country}`,
  );
  return row;
}

async function assertCalendar(page, config, entry) {
  const messages = calendarMessages(config.locale);
  await statusPage(page, "/activities/calendar");
  await assertDocument(page, config);
  await page.getByRole("main").waitFor({ state: "visible" });
  await page
    .getByRole("heading", { name: messages.title, exact: true })
    .waitFor({ state: "visible" });
  entry.calendar = {
    path: "/activities/calendar",
    heading: messages.title,
    direction: config.locale === "fa" ? "rtl" : "ltr",
    calendar: config.calendar,
    timeZone: config.timeZone,
  };
}

async function freshJourney(config) {
  const entry = {
    key: `fresh-${config.key}`,
    cohort: "fresh",
    locale: config.locale,
    browserLocale: config.browserLocale,
    viewport: config.viewport,
    state: "RUNNING",
    contextClosed: false,
    sessionReused: false,
  };
  report.journeys.push(entry);
  const context = await browser.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
    serviceWorkers: "block",
    locale: config.browserLocale,
    timezoneId: config.timeZone,
    viewport: config.viewport,
  });
  context.setDefaultTimeout(10_000);
  context.setDefaultNavigationTimeout(20_000);
  let page;
  let network;
  let problem;
  const tracePath = fileURLToPath(new URL(`${entry.key}.zip`, evidence));
  try {
    await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
    page = await context.newPage();
    network = observePage(context, page, entry);
    await network.ready;
    const initialCookies = await context.cookies(origin);
    assert.deepEqual(
      initialCookies.filter((cookie) => regionalCookieNames.includes(cookie.name)),
      [],
      `${config.key} fresh context starts without regional cookies`,
    );
    await statusPage(page, "/login");
    await assertDocument(page, config);
    const guestCookieNames = await waitUntil(`${config.key} guest regional cookies`, async () => {
      try {
        return await assertGuestCookies(context, config);
      } catch {
        return false;
      }
    });
    entry.guest = {
      initialCookieNames: initialCookies.map((cookie) => cookie.name).sort(),
      document: { locale: config.locale, direction: config.locale === "fa" ? "rtl" : "ltr" },
      cookies: guestCookieNames,
      databaseRowBeforeAuthentication: await readPreference(config.actor.id),
    };
    assert.equal(entry.guest.databaseRowBeforeAuthentication, null);
    await nativeLogin(page, context, config, entry);
    await statusPage(page, "/settings/regional");
    await assertDocument(page, config);
    await exerciseExplicitProfile(page, config, entry);
    await page.screenshot({
      path: fileURLToPath(new URL(`${entry.key}.png`, evidence)),
      fullPage: true,
    });
    network.verify();
  } catch (error) {
    problem = asError(error);
    entry.error = problem.message;
    if (page) {
      await page
        .screenshot({
          path: fileURLToPath(new URL(`${entry.key}-failure.png`, evidence)),
          fullPage: true,
        })
        .catch(() => {});
    }
  } finally {
    try {
      await drainContextRoutes(context);
      if (network && !problem) network.verify();
      await context.tracing.stop({ path: tracePath });
      await context.close();
      entry.contextClosed = true;
    } catch (error) {
      problem ??= asError(error);
      entry.error = problem.message;
    } finally {
      entry.state = problem ? "FAIL" : "PASS";
      writeReport();
    }
  }
  if (problem) throw problem;
  console.log(`${entry.key}: passed`);
}

async function reuseJourney(config) {
  const entry = {
    key: `reuse-${config.key}`,
    cohort: "reuse",
    locale: config.locale,
    browserLocale: config.browserLocale,
    viewport: config.viewport,
    state: "RUNNING",
    contextClosed: false,
    sessionReused: true,
    nativeLoginAttempted: false,
  };
  report.journeys.push(entry);
  const session = nativeSessions.get(config.key);
  assert.ok(session, `Native session for ${config.key} is retained in memory`);
  const context = await browser.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
    serviceWorkers: "block",
    locale: config.browserLocale,
    timezoneId: config.timeZone,
    viewport: config.viewport,
    storageState: structuredClone(session),
  });
  context.setDefaultTimeout(10_000);
  context.setDefaultNavigationTimeout(20_000);
  let page;
  let network;
  let problem;
  const tracePath = fileURLToPath(new URL(`${entry.key}.zip`, evidence));
  try {
    await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
    page = await context.newPage();
    network = observePage(context, page, entry);
    await network.ready;
    const before = await readPreference(config.actor.id);
    assertPreferenceRow(before, config);
    await statusPage(page, "/settings/regional");
    await assertDocument(page, config);
    const controls = await waitForSettingsControls(page, config);
    assert.equal(await controls.zoneSwitch.getAttribute("aria-checked"), "true");
    assert.equal(
      await controls.country.textContent(),
      countryName(config.locale, config.country),
      `${config.key} persisted country is rendered`,
    );
    await assertCalendar(page, config, entry);
    assert.deepEqual(
      await readPreference(config.actor.id),
      before,
      `${config.key} reuse does not autosave`,
    );
    assert.deepEqual(
      network.state.actionRequests,
      [],
      `${config.key} reuse has no automatic server action`,
    );
    entry.database = { unchangedAfterReuse: true, persisted: before };
    await page.screenshot({
      path: fileURLToPath(new URL(`${entry.key}.png`, evidence)),
      fullPage: true,
    });
    network.verify();
  } catch (error) {
    problem = asError(error);
    entry.error = problem.message;
    if (page) {
      await page
        .screenshot({
          path: fileURLToPath(new URL(`${entry.key}-failure.png`, evidence)),
          fullPage: true,
        })
        .catch(() => {});
    }
  } finally {
    try {
      await drainContextRoutes(context);
      if (network && !problem) network.verify();
      await context.tracing.stop({ path: tracePath });
      await context.close();
      entry.contextClosed = true;
    } catch (error) {
      problem ??= asError(error);
      entry.error = problem.message;
    } finally {
      entry.state = problem ? "FAIL" : "PASS";
      writeReport();
    }
  }
  if (problem) throw problem;
  console.log(`${entry.key}: passed`);
}

try {
  const readOnly = await pool.query("SHOW default_transaction_read_only");
  assert.equal(readOnly.rows[0].default_transaction_read_only, "on");
  const baselineBefore = await readWitnesses();
  writeFileSync(
    new URL("baseline-before.json", evidence),
    `${JSON.stringify(baselineBefore, null, 2)}\n`,
  );
  report.databaseChecks.push({ baselineBefore });
  for (const config of configs) {
    assert.equal(await readPreference(config.actor.id), null, `${config.key} seed row is absent`);
  }
  browser = await chromium.launch({ headless: true });
  report.browserVersion = browser.version();
  for (const config of configs) {
    await freshJourney(config);
  }
  assert.equal(report.nativeLogins.length, 3, "Exactly three native regional logins");
  for (const config of configs) {
    await reuseJourney(config);
  }
  assert.equal(
    report.journeys.filter((entry) => entry.sessionReused).length,
    3,
    "Exactly three regional session reuses",
  );
  const baselineAfter = await readWitnesses();
  writeFileSync(
    new URL("baseline-after.json", evidence),
    `${JSON.stringify(baselineAfter, null, 2)}\n`,
  );
  assert.deepEqual(baselineAfter, baselineBefore, "Existing baseline actors remain unchanged");
  report.databaseChecks.push({ baselineAfter, baselineUnchanged: true });
  if (fatal instanceof Error) throw asError(fatal);
  report.state = "PASS";
} catch (error) {
  report.state = "FAIL";
  report.error = String(error);
  fatal = asError(error);
} finally {
  nativeSessions.clear();
  report.cleanup.sessionCacheCleared = true;
  try {
    if (browser) await browser.close();
    report.cleanup.browserClosed = true;
  } catch (error) {
    report.state = "FAIL";
    report.error = String(error);
    fatal ??= asError(error);
  } finally {
    try {
      await pool.end();
      report.cleanup.databasePoolClosed = true;
    } catch (error) {
      report.state = "FAIL";
      report.error = String(error);
      fatal ??= asError(error);
    } finally {
      writeReport();
    }
  }
}

if (fatal instanceof Error) throw fatal;
