import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  ANALYTICS_BROWSER as actor,
  ANALYTICS_DEALS as deals,
  ANALYTICS_LEADS as leads,
} from "./browser-analytics-seed.mjs";

// Use the same admission boundary as the existing full browser packs, before loading clients.
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

const { chromium } = await import("../tools/browser-smoke/node_modules/playwright/index.mjs");
const { default: pg } = await import("pg");
const { default: superjson } = await import("superjson");
const { createTranslator } = await import("next-intl");
const origin = process.env.BASE_URL;
const evidence = new URL("../test-results/browser-smoke/analytics/", import.meta.url);
const file = (name) => fileURLToPath(new URL(name, evidence));
const catalog = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const copy = Object.fromEntries(
  ["en", "de", "fa"].map((locale) => {
    const stats = catalog(`src/features/stats/messages/stats.${locale}.json`);
    return [
      locale,
      {
        stats,
        format: createTranslator({
          locale: new Intl.Locale(locale, {
            numberingSystem: actor.regional.numberingSystem,
          }).toString(),
          messages: stats,
        }),
        regional: catalog(`src/features/i18n/messages/${locale}.json`).preferences,
      },
    ];
  }),
);
const languages = { en: "English", de: "Deutsch", fa: "فارسی" };
const desktop = { width: 1280, height: 900 };
const mobile = { width: 390, height: 844 };
const labels = {
  won: "trendValue",
  closed: "scoreWinRate",
  wonValue: "scoreAvgDeal",
  wonCycle: "scoreCycle",
};
const presets = {
  last30: "last30Days",
  month: "thisMonth",
  quarter: "thisQuarter",
  year: "thisYear",
};
const won = ["recorded", "zero", "missing", "negativeCycle", "boundary"];
const population = {
  won: [won, "140.7067", 4],
  closed: [[...won, "lost"], "200.7067", 5],
  wonValue: [["recorded", "zero", "negativeCycle", "boundary"], "140.7067", 4],
  wonCycle: [["recorded", "zero", "missing", "boundary"], "130.7067", 3],
};
const forbidden = [
  deals.otherCurrency.id,
  deals.otherOwner.id,
  deals.hidden.id,
  deals.restricted.id,
];
const cohortFixture = {
  id: "00000000-0000-4000-8000-000000000620",
  title: "CI private cohort witness",
};

mkdirSync(evidence, { recursive: true });
const report = {
  state: "RUNNING",
  revision: process.env.APP_COMMIT,
  buildId: readFileSync(new URL("../.next/BUILD_ID", import.meta.url), "utf8").trim(),
  browser: "Chromium",
  criteria:
    "Live CRM drill-down, recorded source, viewer civil periods and rendering. Cohort and stage aging use the disposable capture proposal.",
  limits:
    "Disposable synthetic CRM records and hosted Chromium viewports. The actor is limited to their own reports. Cohort capture uses the unnumbered proposal. No installed history, provider, human accessibility or release acceptance.",
  nativeLogins: 0,
  journeys: [],
  preferenceChanges: [],
  cleanup: { browserClosed: false, databasePoolClosed: false, sessionCleared: false },
};
const save = () => writeFileSync(file("receipt.json"), `${JSON.stringify(report, null, 2)}\n`);
const started = performance.now();
const elapsed = () => Math.round(performance.now() - started);
const csrfReady = (page) =>
  page.waitForFunction(
    () => document.cookie.split("; ").some((cookie) => cookie.startsWith("wd_csrf=")),
    undefined,
    { timeout: 7000 },
  );

function phase(entry, name) {
  entry.phase = name;
  entry.phases.push({ name, elapsedMs: elapsed() });
  save();
}

async function bounded(label, operation, milliseconds) {
  const timer = new AbortController();
  try {
    return await Promise.race([
      operation(),
      delay(milliseconds, undefined, { signal: timer.signal }).then(() => {
        assert.fail(`${label} exceeded ${milliseconds}ms`);
      }),
    ]);
  } finally {
    timer.abort();
  }
}
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
  connectionTimeoutMillis: 5000,
  query_timeout: 5000,
  statement_timeout: 5000,
  options: "-c default_transaction_read_only=on",
});
let browser;
let session;
let currency;
let asynchronousFailure = false;

function safeError(error) {
  return (error instanceof Error ? error.message : String(error))
    .replaceAll(actor.password, "[redacted]")
    .replaceAll(actor.email, "[redacted]")
    .slice(0, 3500);
}

process.on("unhandledRejection", () => {
  asynchronousFailure = true;
  report.state = "FAIL";
  report.error = "Unhandled asynchronous browser harness rejection";
  process.exitCode = 1;
  save();
});

const exact = (name) => ({ name, exact: true });
const dashboard = (page, locale) => page.getByRole("main", exact(copy[locale].stats.title));

async function journey(
  name,
  exercise,
  { viewport = desktop, colorScheme = "light", timezoneId = "UTC" } = {},
) {
  const entry = {
    name,
    viewport,
    colorScheme,
    state: "RUNNING",
    startedMs: elapsed(),
    phases: [],
    contextClosed: false,
    reports: [],
  };
  report.journeys.push(entry);
  phase(entry, "create-context");
  const context = await browser.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
    serviceWorkers: "block",
    viewport,
    colorScheme,
    timezoneId,
    storageState: session === undefined ? undefined : structuredClone(session),
  });
  context.setDefaultTimeout(5000);
  context.setDefaultNavigationTimeout(15000);
  const unexpected = [];
  const errors = [];
  const failures = [];
  context.on("page", (opened) => {
    opened.on("pageerror", (error) => errors.push(safeError(error)));
    opened.on("console", (message) => {
      if (message.type() === "error") errors.push(safeError(message.text()));
    });
  });
  let page;
  try {
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.origin === origin) return route.continue();
      unexpected.push(url.origin);
      return route.abort("blockedbyclient");
    });
    await context.routeWebSocket("**/*", (socket) => {
      unexpected.push(new URL(socket.url()).origin);
      return socket.close({ code: 1008, reason: "No sockets in analytics browser qualification" });
    });
    page = await context.newPage();
    phase(entry, "exercise");
    await bounded(name, () => exercise(page, context, entry), 45_000);
    assert.deepEqual(unexpected, [], "No unexpected origins or sockets");
    assert.deepEqual(errors, [], "No browser errors");
    entry.state = "PASS";
  } catch (error) {
    failures.push(error);
    entry.state = "FAIL";
    entry.error = safeError(error);
    // Never retain login or settings captures, request bodies, headers, traces or storage state.
    if (page && new URL(page.url()).pathname === "/dashboard") {
      await page.screenshot({ path: file(`${name}-failure.png`), timeout: 5000 }).catch(() => {});
    }
  } finally {
    try {
      await context.close();
      entry.contextClosed = true;
    } catch (error) {
      failures.push(error);
      entry.state = "FAIL";
      entry.cleanupError = safeError(error);
    } finally {
      entry.finishedMs = elapsed();
      save();
    }
  }
  if (failures.length > 0) throw failures[0];
}

function rpcRequest(raw, procedure) {
  const url = new URL(raw);
  if (url.origin !== origin || !url.pathname.startsWith("/api/trpc/")) return null;
  const index = decodeURIComponent(url.pathname.slice("/api/trpc/".length))
    .split(",")
    .indexOf(procedure);
  if (index === -1) return null;
  const batch = url.searchParams.get("batch") === "1";
  const input = JSON.parse(url.searchParams.get("input") ?? "null");
  return { batch, index, input: (batch ? input?.[index] : input)?.json };
}

async function rpcAfter(page, procedure, matches, action) {
  const [response] = await Promise.all([
    page.waitForResponse(
      (candidate) => {
        const call = rpcRequest(candidate.url(), procedure);
        return call?.input !== undefined && matches(call.input);
      },
      { timeout: 15000 },
    ),
    action(),
  ]);
  assert.equal(response.status(), 200, `${procedure}: HTTP status`);
  const request = rpcRequest(response.url(), procedure);
  const payload = await bounded(`${procedure} response body`, () => response.json(), 7000);
  const packet = request.batch ? payload[request.index] : payload;
  assert.ok(packet?.result?.data, `${procedure}: actual application result`);
  return { input: request.input, data: superjson.deserialize(packet.result.data) };
}

async function choose(page, label, option, scope = page) {
  await scope.getByRole("combobox", exact(label)).click();
  await page.getByRole("option", exact(option)).click();
}

async function preferences() {
  const { rows } = await pool.query("SELECT timezone,ui FROM user_preferences WHERE user_id=$1", [
    actor.actorId,
  ]);
  assert.equal(rows.length, 1, "One persisted analytics preference row");
  assert.equal(rows[0].ui.appearance, "system");
  return rows[0];
}

async function setRegional(currentLocale, key, option, expected) {
  const labelKey = key === "locale" ? "language" : key;
  const expectedProfile = { ...actor.regional, ...expected };
  const name = `regional-${key}-${option === languages.fa ? "fa" : expected[key]}`.replaceAll(
    /[^a-zA-Z0-9-]/g,
    "-",
  );
  await journey(name, async (page, _context, entry) => {
    phase(entry, "open-regional-settings");
    assert.equal(
      (await page.goto("/settings/regional", { waitUntil: "domcontentloaded" }))?.status(),
      200,
    );
    assert.equal(new URL(page.url()).pathname, "/settings/regional");
    assert.equal(await page.locator("html").getAttribute("lang"), currentLocale);
    phase(entry, "wait-for-csrf");
    await csrfReady(page);
    if (key === "calendar") {
      phase(entry, "open-regional-formats");
      await expandRegionalFormats(page, currentLocale);
    }
    phase(entry, "choose-and-observe-action");
    const [response] = await Promise.all([
      page.waitForResponse(
        (candidate) =>
          candidate.url() === `${origin}/settings/regional` &&
          candidate.request().method() === "POST" &&
          Boolean(candidate.request().headers()["next-action"]),
        { timeout: 15000 },
      ),
      choose(page, copy[currentLocale].regional[labelKey], option),
    ]);
    assert.equal(response.status(), 200, "Regional server action responded");
    phase(entry, "verify-persisted-preferences");
    const stored = await bounded(
      "Regional preference persistence",
      async () => {
        for (let attempt = 0; attempt < 20; attempt += 1) {
          const actual = await preferences();
          if (
            actual.timezone === expected.timeZone &&
            Object.entries(expectedProfile).every(
              ([field, value]) => actual.ui.localePreferences?.[field] === value,
            )
          )
            return actual;
          await delay(250);
        }
        assert.fail("Regional settings did not persist the requested values");
      },
      7000,
    );
    assert.equal(stored.timezone, expected.timeZone);
    for (const [field, value] of Object.entries(expectedProfile)) {
      assert.equal(stored.ui.localePreferences?.[field], value, `Persisted ${field}`);
    }
    phase(entry, "verify-regional-ui-settled");
    const regional = copy[expected.locale].regional;
    if (key === "calendar") await expandRegionalFormats(page, expected.locale);
    await page
      .getByRole("combobox", exact(regional[labelKey]))
      .and(page.locator(":enabled"))
      .filter({ hasText: option })
      .waitFor({ timeout: 7000 });
    assert.equal(await page.locator("html").getAttribute("lang"), expected.locale);
    assert.equal(await page.getByRole("alert").filter({ hasText: regional.saveError }).count(), 0);
    report.preferenceChanges.push(expectedProfile);
  });
}

async function expandRegionalFormats(page, locale) {
  const button = page.getByRole("button", exact(copy[locale].regional.customizeFormats));
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
}

function shiftDay(iso, days) {
  const value = new Date(`${iso}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function expectedStart(preset, today, calendar) {
  if (preset === "last30") return shiftDay(today, -29);
  const formatter = new Intl.DateTimeFormat(`en-u-ca-${calendar}-nu-latn`, {
    timeZone: "UTC",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
  const parts = (iso) =>
    Object.fromEntries(
      formatter
        .formatToParts(new Date(`${iso}T00:00:00Z`))
        .map(({ type, value }) => [type, Number(value)]),
    );
  const current = parts(today);
  const month =
    preset === "month"
      ? current.month
      : preset === "quarter"
        ? 1 + 3 * Math.floor((current.month - 1) / 3)
        : 1;
  // Independent civil-date oracle: find day 1 of the expected calendar month by scanning ISO days.
  for (let offset = 0; offset < 366; offset += 1) {
    const iso = shiftDay(today, -offset);
    const candidate = parts(iso);
    if (candidate.year === current.year && candidate.month === month && candidate.day === 1)
      return iso;
  }
  throw new Error(`Could not identify ${calendar} ${preset} start`);
}

function assertScope({ input, data }, zone, expected) {
  assert.equal(input.currency, currency);
  assert.equal(input.timeZoneIdentity, zone);
  assert.deepEqual(input.ownerScope, { kind: "me" });
  assert.equal(data.currency, currency);
  assert.deepEqual(data.effectiveOwnerScope, { kind: "me" });
  assert.equal(data.timeZone, zone, "Server uses the saved viewer zone");
  for (const [key, value] of Object.entries(expected)) assert.equal(input[key], value, key);
}

function trigger(page, locale, metric) {
  const S = copy[locale].stats;
  return dashboard(page, locale).getByRole(
    "button",
    exact(`${S.recordsView}: ${S[labels[metric]]}`),
  );
}

async function openDashboard(page, locale, calendar, zone, { allPipelines = false } = {}) {
  const pipelineId = allPipelines ? null : actor.pipelineId;
  const S = copy[locale].stats;
  let premature = 0;
  const beforeOpen = (request) => {
    if (rpcRequest(request.url(), "stats.records")) premature += 1;
  };
  page.on("request", beforeOpen);
  const clock = () =>
    pool.query("SELECT to_char(now() AT TIME ZONE $1, 'YYYY-MM-DD') AS today", [zone]);
  const before = await clock();
  const initial = await rpcAfter(
    page,
    "stats.dashboard",
    (input) => input.pipelineId === null,
    async () => {
      assert.equal((await page.goto("/dashboard"))?.status(), 200);
      assert.equal(new URL(page.url()).pathname, "/dashboard");
    },
  );
  const today = initial.input.to;
  assert.match(today, /^\d{4}-\d{2}-\d{2}$/);
  const after = await clock();
  assert.ok(
    [before.rows[0].today, after.rows[0].today].includes(today),
    "Dashboard civil date agrees with the real viewer-zone clock",
  );
  const from = expectedStart("year", today, calendar);
  assertScope(initial, zone, { from, to: today, pipelineId: null });
  const main = dashboard(page, locale);
  await main.getByRole("heading", exact(S.title)).waitFor();
  await main
    .getByText(calendar === "persian" ? S.presetCalendarPersian : S.presetCalendarGregorian, {
      exact: true,
    })
    .waitFor();
  await main.getByText(S._extra.bucketNotice, { exact: true }).waitFor();
  assert.equal(
    await main.getByRole("button", exact(S.thisYear)).getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(await main.getByRole("button", exact(S.ownerScopeLabel)).isDisabled(), true);
  const selected = allPipelines
    ? initial
    : await rpcAfter(
        page,
        "stats.dashboard",
        (input) => input.pipelineId === pipelineId,
        () => choose(page, S.pipelineLabel, actor.pipelineName, main),
      );
  assertScope(selected, zone, { from, to: today, pipelineId });
  await trigger(page, locale, "closed").waitFor();
  assert.equal(premature, 0, "No contributing deal fetch before opening the drawer");
  page.off("request", beforeOpen);
  return selected;
}

async function selectPreset(page, locale, calendar, report, preset) {
  const { from: previousFrom, to, pipelineId, timeZoneIdentity: zone } = report.input;
  const from = expectedStart(preset, to, calendar);
  const button = dashboard(page, locale).getByRole(
    "button",
    exact(copy[locale].stats[presets[preset]]),
  );
  let selected = report;
  if (from === previousFrom) await button.click();
  else
    selected = await rpcAfter(
      page,
      "stats.dashboard",
      (input) => input.from === from && input.to === to && input.pipelineId === pipelineId,
      () => button.click(),
    );
  await trigger(page, locale, "closed").waitFor();
  assert.equal(await button.getAttribute("aria-pressed"), "true");
  assertScope(selected, zone, { from, to, pipelineId });
  return selected;
}

function assertPopulation(result, [keys, value, valueCount]) {
  assert.deepEqual(result.totals, { count: keys.length, value, valueCount });
  assert.deepEqual(
    result.rows.map((row) => row.id).sort(),
    keys.map((key) => deals[key].id).sort(),
  );
  for (const key of keys) {
    const fixture = deals[key];
    const row = result.rows.find((item) => item.id === fixture.id);
    assert.equal(row.title, fixture.title);
    assert.equal(row.value, fixture.value);
    assert.equal(row.status, fixture.status);
  }
}

async function openRecords(page, locale, metric, scope, entry, expected) {
  const { stats: S, format } = copy[locale];
  const opener = trigger(page, locale, metric);
  const { from, to, pipelineId, timeZoneIdentity: zone } = scope;
  const records = await rpcAfter(
    page,
    "stats.records",
    (input) => input.metric === metric,
    () => opener.press("Enter"),
  );
  assertScope(records, zone, { from, to, pipelineId });
  const { data } = records;
  assert.equal(data.metric, metric);
  assert.equal(data.nextCursor, null);
  assert.equal(data.rows.length, data.totals.count);
  assert.ok(data.definitionVersion);
  assert.ok(Number.isFinite(Date.parse(data.generatedAt)));
  assert.ok(
    data.rows.every((row) => !forbidden.includes(row.id)),
    "Excluded fixture rows stay out",
  );
  if (expected) assertPopulation(data, expected);
  const dialog = page.getByRole("dialog", exact(S[labels[metric]]));
  await dialog.getByText(S.recordsLiveNotice, { exact: true }).waitFor();
  const count = format("_extra.recordsCount", { count: data.totals.count });
  const status = dialog.getByRole("status").filter({ hasText: count });
  assert.equal((await status.textContent())?.trim(), count);
  await dialog.getByText(`${S.recordsTimeZone}: ${zone}`, { exact: false }).waitFor();
  if (data.rows.length > 0) {
    const table = dialog.getByRole("table", exact(S.recordsTable));
    await table.waitFor();
    assert.equal(await table.getByRole("row").count(), data.rows.length + 1);
    for (const row of data.rows) {
      const name = exact(`${row.title} ${S.recordsOpenNewTab}`);
      const link = table.getByRole("link", name);
      assert.equal(await link.getAttribute("href"), `/deals/${row.id}`);
      assert.equal(await link.getAttribute("target"), "_blank");
      const line = table.getByRole("row").filter({ has: page.getByRole("link", name) });
      assert.equal((await line.getByRole("cell").nth(0).textContent())?.trim(), S[row.status]);
      const value = (await line.getByRole("cell").nth(1).textContent())?.trim();
      assert.ok(value, "Recorded value cell has text");
      if (row.value === null) assert.equal(value, S.noValue);
      else assert.notEqual(value, S.noValue);
      if (row.id === deals.zero.id) {
        const digits = new Intl.Locale(locale, {
          numberingSystem: actor.regional.numberingSystem,
        }).toString();
        assert.ok(value.includes(new Intl.NumberFormat(digits).format(0)));
      }
    }
  } else {
    await dialog.getByText(S.recordsEmpty, { exact: true }).waitFor();
    assert.equal(await dialog.getByRole("table").count(), 0);
  }
  entry.reports.push({
    metric,
    from,
    to,
    zone,
    currency,
    pipelineId,
    definitionVersion: data.definitionVersion,
    totals: data.totals,
    ids: data.rows.map((row) => row.id),
  });
  return { dialog, opener };
}

async function closeRecords(page, { dialog, opener }) {
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  await opener.and(page.locator(":focus")).waitFor();
}

async function capture(page, name) {
  await page.screenshot({ path: file(`${name}.png`), animations: "disabled", timeout: 5000 });
}

async function verifyRender(page, locale, colorScheme, viewport, dialog) {
  const rtl = locale === "fa";
  assert.equal(await page.locator("html").getAttribute("lang"), locale);
  assert.equal(await page.locator("html").getAttribute("dir"), rtl ? "rtl" : "ltr");
  assert.equal(
    await page.locator("html").evaluate((node) => node.classList.contains("dark")),
    colorScheme === "dark",
  );
  if (dialog) {
    assert.equal(await dialog.getAttribute("dir"), rtl ? "rtl" : "ltr");
    assert.equal(await dialog.getAttribute("data-side"), rtl ? "left" : "right");
    // The sheet is visible while translating in from the edge. Measure settled layout.
    await page.waitForFunction(
      (element) => element.getAnimations().every((animation) => animation.playState !== "running"),
      await dialog.elementHandle(),
      { timeout: 5000 },
    );
    const box = await dialog.boundingBox();
    assert.ok(
      box && box.x >= -1 && box.x + box.width <= viewport.width + 1,
      "Drawer fits viewport",
    );
  }
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    true,
  );
}

async function assertHeadlineUnbroken(scoreboard) {
  const lineCount = await scoreboard
    .locator("dd")
    .first()
    .evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return new Set(Array.from(range.getClientRects(), (rect) => Math.round(rect.top))).size;
    });
  assert.equal(lineCount, 1, "The exact won-value headline fits on one line");
}

async function exercisePresets(page, locale, calendar, current, entry) {
  const proof = { year: [current.input.from, current.input.to] };
  for (const [preset, metric] of [
    ["month", "won"],
    ["quarter", "closed"],
    ["year", "wonValue"],
    ["last30", "wonCycle"],
  ]) {
    // A coincident boundary may reuse a dashboard cache key. An opened drawer performs a fresh
    // native request and independently proves the range passed from the selected button.
    const target = expectedStart(preset, current.input.to, calendar);
    const button = dashboard(page, locale).getByRole(
      "button",
      exact(copy[locale].stats[presets[preset]]),
    );
    await button.click();
    assert.equal(await button.getAttribute("aria-pressed"), "true");
    const scope = { ...current.input, from: target };
    await closeRecords(page, await openRecords(page, locale, metric, scope, entry));
    proof[preset] = [target, current.input.to];
  }
  entry.presets = { calendar, ranges: proof };
}

async function matrix(locale, calendar) {
  const S = copy[locale].stats;
  for (const viewport of [desktop, mobile]) {
    for (const colorScheme of ["light", "dark"]) {
      const name = `${locale}-${calendar}-${colorScheme}-${viewport.width}`;
      await journey(
        name,
        async (page, _context, entry) => {
          Object.assign(entry, { locale, calendar, zone: actor.timeZone });
          phase(entry, "open-dashboard");
          const initial = await openDashboard(page, locale, calendar, actor.timeZone);
          entry.initialRange = { from: initial.input.from, to: initial.input.to };
          const current = await selectPreset(page, locale, calendar, initial, "last30");
          assert.deepEqual(current.data.dealPerformance.won, { count: 5, value: "140.7067" });
          assert.equal(current.data.dealPerformance.lost.count, 1);
          assert.equal(current.data.winRate, 5 / 6);
          assert.equal(current.data.wonDealStats.avgValue, "35.1767");
          assert.equal(current.data.wonDealStats.medianCycleDays, 2.5);
          entry.scoreboard = {
            won: current.data.dealPerformance.won,
            lost: current.data.dealPerformance.lost,
            winRate: current.data.winRate,
            averageWonValue: current.data.wonDealStats.avgValue,
            medianCycleDays: current.data.wonDealStats.medianCycleDays,
          };
          const main = dashboard(page, locale);
          const scoreboard = main.locator("dl").filter({ hasText: S.scoreWinRate });
          await scoreboard
            .getByText(copy[locale].format("_extra.percent", { count: 83 }), { exact: true })
            .waitFor();
          await verifyRender(page, locale, colorScheme, viewport);
          await bounded(
            "Dashboard font readiness",
            () => page.evaluate(() => document.fonts.ready.then(() => undefined)),
            5000,
          );
          await assertHeadlineUnbroken(scoreboard);
          await main.getByRole("heading", exact(S.title)).scrollIntoViewIfNeeded();
          await capture(page, `${name}-dashboard`);
          phase(entry, "open-and-measure-drawer");
          const opened = await openRecords(
            page,
            locale,
            "closed",
            current.input,
            entry,
            population.closed,
          );
          await verifyRender(page, locale, colorScheme, viewport, opened.dialog);
          await capture(page, `${name}-drawer`);
          entry.accessibility = await opened.dialog.ariaSnapshot();
          if (locale === "en" && viewport === desktop && colorScheme === "light") {
            phase(entry, "open-record-in-new-tab");
            const [popup] = await Promise.all([
              page.waitForEvent("popup", { timeout: 7000 }),
              opened.dialog
                .getByRole("link", exact(`${deals.recorded.title} ${S.recordsOpenNewTab}`))
                .click(),
            ]);
            // If an assertion fails, journey() closes the context and this popup without
            // letting a cleanup error replace the initial failure.
            await popup.waitForURL(`${origin}/deals/${deals.recorded.id}`);
            await popup.getByText(deals.recorded.title, { exact: true }).first().waitFor();
            await opened.dialog.waitFor();
            assert.equal(new URL(page.url()).pathname, "/dashboard");
            entry.recordOpenedInNewTab = true;
            await popup.close();
            await page.bringToFront();
          }
          await closeRecords(page, opened);
          if (locale === "en" && viewport === desktop && colorScheme === "light") {
            phase(entry, "verify-other-record-populations");
            for (const metric of ["won", "wonValue", "wonCycle"]) {
              await closeRecords(
                page,
                await openRecords(page, locale, metric, current.input, entry, population[metric]),
              );
            }
          }
        },
        { viewport, colorScheme },
      );
    }
  }
}

async function pickDay(page, label, iso) {
  const control = dashboard(page, "en").getByRole("button", exact(label));
  await control.click();
  const year = page.getByRole("combobox", exact("Choose the Year"));
  const month = page.getByRole("combobox", exact("Choose the Month"));
  const [y, m] = iso.split("-");
  if ((await year.inputValue()) !== y) await year.selectOption(y);
  const monthIndex = String(Number(m) - 1);
  if ((await month.inputValue()) !== monthIndex) await month.selectOption(monthIndex);
  const cell = page.locator(`[role="gridcell"][data-day="${iso}"]:not([data-outside])`);
  if ((await cell.getAttribute("aria-selected")) === "true") await page.keyboard.press("Escape");
  else await cell.getByRole("button").click();
  await year.waitFor({ state: "hidden" });
}

async function verifyZoneBoundary(zone, day, included) {
  await journey(`boundary-${included ? "utc" : "los-angeles"}`, async (page, _context, entry) => {
    const S = copy.en.stats;
    await openDashboard(page, "en", "gregory", zone);
    await pickDay(page, S.rangeStartLabel, day);
    const oneDay = await rpcAfter(
      page,
      "stats.dashboard",
      (input) => input.from === day && input.to === day,
      () => pickDay(page, S.rangeEndLabel, day),
    );
    assertScope(oneDay, zone, { from: day, to: day, pipelineId: actor.pipelineId });
    const expected = included ? [["boundary"], "7.25", 1] : [[], "0.00", 0];
    assert.deepEqual(oneDay.data.dealPerformance.won, {
      count: expected[0].length,
      value: expected[1],
    });
    await closeRecords(page, await openRecords(page, "en", "won", oneDay.input, entry, expected));
  });
}

async function verifyRestrictedPipeline() {
  await journey("restricted-pipeline", async (page, _context, entry) => {
    const S = copy.en.stats;
    const initial = await openDashboard(page, "en", "gregory", actor.timeZone, {
      allPipelines: true,
    });
    const all = await selectPreset(page, "en", "gregory", initial, "last30");
    assert.deepEqual(all.data.dealPerformance.won, { count: 5, value: "140.7067" });
    await dashboard(page, "en").getByText(`${S.scoreWon}: 5`, { exact: true }).waitFor();
    await closeRecords(
      page,
      await openRecords(page, "en", "won", all.input, entry, population.won),
    );
  });
}

async function verifyRecordedDealSources() {
  await journey("en-recorded-deal-sources", async (page, _context, entry) => {
    const S = copy.en.stats;
    const initial = await openDashboard(page, "en", "gregory", actor.timeZone, {
      allPipelines: true,
    });
    const filtered = await selectPreset(page, "en", "gregory", initial, "last30");
    const result = await rpcAfter(
      page,
      "stats.recordedDealSource",
      (input) =>
        input.from === filtered.input.from &&
        input.to === filtered.input.to &&
        input.currency === currency &&
        input.pipelineId === null &&
        input.timeZoneIdentity === actor.timeZone,
      () => page.getByRole("tab", exact(S.recordedSource.tab)).click(),
    );
    assert.deepEqual(result.input.ownerScope, { kind: "me" });
    assert.equal(result.data.state, "available");
    assert.equal(result.data.effectiveOwnerScope, "me");
    assert.equal(result.data.timeZone, actor.timeZone);
    assert.equal(result.data.currency, currency);
    const rows = result.data.rows.map(
      ({ channel, added, won, lost, wonValue, wonValueCount, wonCycleCount }) => [
        channel,
        added,
        won,
        lost,
        wonValue,
        wonValueCount,
        wonCycleCount,
      ],
    );
    assert.deepEqual(rows, [
      ["referral", 2, 2, 0, "123.4567", 2, 2],
      ["unrecognized", 1, 1, 0, "10.00", 1, 0],
      ["unrecorded", 2, 1, 1, null, 0, 1],
      ["web_form", 1, 1, 0, "7.25", 1, 1],
    ]);
    const payload = JSON.stringify(result.data);
    assert.ok(!payload.includes("CI unrecognized source witness"));
    assert.ok(forbidden.every((id) => !payload.includes(id)));
    const panel = page.getByRole("region", exact(S.recordedSource.title));
    await panel
      .getByRole("row", { name: /Referral/ })
      .getByText(/123\.4567/)
      .waitFor();
    await panel.getByRole("row", { name: /Unrecognized channel/ }).waitFor();
    await panel.getByRole("row", { name: /Channel unrecorded/ }).waitFor();
    await panel.scrollIntoViewIfNeeded();
    await capture(page, "en-recorded-deal-sources");
    entry.sourceProof = { channelSummaries: rows };
  });
}

async function verifyLeadHandoff() {
  await journey("en-current-lead-links", async (page, _context, entry) => {
    const S = copy.en.stats;
    const initial = await openDashboard(page, "en", "gregory", actor.timeZone, {
      allPipelines: true,
    });
    const filtered = await selectPreset(page, "en", "gregory", initial, "last30");
    const result = await rpcAfter(
      page,
      "stats.currentLeadHandoff",
      (input) =>
        input.from === filtered.input.from &&
        input.to === filtered.input.to &&
        input.pipelineId === null &&
        input.currency === currency,
      () => page.getByRole("tab", exact(S.recordedSource.tab)).click(),
    );
    assert.deepEqual(result.input.ownerScope, { kind: "me" });
    const counts = {
      eligibleLeads: 5,
      linkedLeads: 2,
      distinctLinkedDeals: 1,
      pendingUnlinkedLeads: 1,
      archivedUnlinkedLeads: 1,
      unavailableLinkedLeads: 1,
    };
    assert.deepEqual(result.data.counts, counts);
    assert.equal(result.data.state, "available");
    assert.equal(result.data.timeZone, actor.timeZone);
    assert.equal(result.data.firstResponseHistory, "unqualified");
    const payload = JSON.stringify(result.data);
    assert.ok(Object.values(leads).every((id) => !payload.includes(id)));
    assert.ok(Object.values(deals).every(({ id }) => !payload.includes(id)));
    const panel = page.getByRole("region", exact(S.currentHandoff.title));
    await panel.getByText(S.currentHandoff.eligibleLeads, { exact: true }).waitFor();
    assert.deepEqual((await panel.getByRole("definition").allTextContents()).slice(-6), [
      "5",
      "2",
      "1",
      "1",
      "1",
      "1",
    ]);
    await panel.scrollIntoViewIfNeeded();
    await capture(page, "en-current-lead-links");
    await rpcAfter(
      page,
      "stats.dashboard",
      (input) => input.pipelineId === actor.pipelineId,
      () => choose(page, S.pipelineLabel, actor.pipelineName, dashboard(page, "en")),
    );
    await panel.getByText(S.currentHandoff.allPipelines, { exact: true }).waitFor();
    assert.equal(await panel.getByText(S.currentHandoff.eligibleLeads, { exact: true }).count(), 0);
    entry.leadLinkProof = { counts, pipelineSelectionWithheld: true };
  });
}

async function verifySavedPerformance() {
  await journey("en-private-saved-performance", async (page, _context, entry) => {
    const S = copy.en.stats;
    const copySaved = S.savedPerformance;
    const name = "CI fixed performance filters";
    const displayName = `\u2068${name}\u2069`;
    const initial = await openDashboard(page, "en", "gregory", actor.timeZone, {
      allPipelines: true,
    });
    const filtered = await selectPreset(page, "en", "gregory", initial, "last30");
    const toggle = page.getByRole("button", exact(copySaved.title));
    const panel = page.getByRole("region", exact(copySaved.title));
    await toggle.click();
    await panel.getByRole("textbox", exact(copySaved.name)).fill(name);
    await panel.getByRole("button", exact(copySaved.save)).click();
    await panel.getByText(copySaved.saved, { exact: true }).waitFor();
    await openDashboard(page, "en", "gregory", actor.timeZone);
    await toggle.click();

    const run = panel.getByRole("button", exact(copySaved.runNamed.replace("{name}", displayName)));
    const rerun = await rpcAfter(
      page,
      "stats.savedPerformanceRerun",
      (input) => typeof input.id === "string",
      () => run.click(),
    );
    assert.deepEqual(Object.keys(rerun.input), ["id"]);
    assert.equal(rerun.data.state, "available");
    assert.deepEqual(rerun.data.definition, {
      version: 1,
      from: filtered.input.from,
      to: filtered.input.to,
      pipelineId: null,
      currency,
      ownerScope: { kind: "me" },
    });
    assert.deepEqual(rerun.data.dashboard.dealPerformance, filtered.data.dealPerformance);
    assert.equal(rerun.data.dashboard.timeZone, actor.timeZone);
    await panel.getByText(copySaved.runResult, { exact: true }).waitFor();
    await panel.scrollIntoViewIfNeeded();
    await capture(page, "en-private-saved-performance");

    await panel
      .getByRole("button", exact(copySaved.deleteNamed.replace("{name}", displayName)))
      .click();
    const confirm = page.getByRole("dialog", exact(copySaved.deleteTitle));
    await confirm.getByRole("button", exact(copySaved.deleteConfirm)).click();
    await panel.getByText(copySaved.deleted, { exact: true }).waitFor();
    await panel.getByText(copySaved.empty, { exact: true }).waitFor();
    entry.savedPerformanceProof = {
      restoredAfterNavigation: true,
      exactDefinition: true,
      matchesAdHocCalculation: true,
      removed: true,
    };
  });
}

async function verifyDealReportDownload() {
  await journey("en-won-deal-csv", async (page, _context, entry) => {
    const S = copy.en.stats;
    const initial = await openDashboard(page, "en", "gregory", actor.timeZone, {
      allPipelines: true,
    });
    const filtered = await selectPreset(page, "en", "gregory", initial, "last30");
    const drawer = await openRecords(page, "en", "won", filtered.input, entry, population.won);
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 15000 }),
      drawer.dialog.getByRole("link", exact(S.recordsExport)).click(),
    ]);
    assert.equal(download.suggestedFilename(), "deal-report-won.csv");
    let csv = "";
    try {
      const stream = await download.createReadStream();
      assert.ok(stream, "The authorized download has a readable file");
      for await (const chunk of stream) {
        csv += chunk.toString("utf8");
        assert.ok(csv.length <= 16_384, "The file stays within its byte limit");
      }
    } finally {
      await download.delete();
    }
    const lines = csv.split("\r\n");
    assert.equal(lines.shift(), "deal_id,status,currency,value,created_at_utc,closed_at_utc");
    assert.equal(lines.pop(), "");
    const fields = lines.map((line) => line.split(","));
    assert.deepEqual(
      fields.map((row) => row[0]),
      entry.reports[0].ids,
    );
    for (const [id, status, unit, value, createdAt, closedAt] of fields) {
      assert.equal(status, "won");
      assert.equal(unit, currency);
      assert.ok(!forbidden.includes(id));
      assert.match(createdAt, /\.\d{6}Z$/);
      assert.match(closedAt, /\.\d{6}Z$/);
      const deal = Object.values(deals).find((row) => row.id === id);
      assert.ok(deal, "Each row identifies an authorized fixture");
      assert.equal(value, deal.value ?? "");
    }
    entry.exportProof = { rows: fields.length, exactDecimalValues: true, retainedFile: false };
    await closeRecords(page, drawer);
  });
}

// The entry point has already admitted the disposable hosted database. Run the private
// proposal only after the existing I1 assertions have finished against the canonical prefix.
async function activateSyntheticCohort() {
  const fixturePool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 5000,
    query_timeout: 8000,
    statement_timeout: 5000,
  });
  report.cleanup.historyFixturePoolClosed = false;
  try {
    await fixturePool.query(
      readFileSync(
        new URL("../docs/analytics/history-capture-proposal.sql", import.meta.url),
        "utf8",
      ),
    );
    await fixturePool.query(
      `INSERT INTO public.deals (id,title,owner_id,pipeline_id,stage_id,currency,visibility_level,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,'owner',pg_catalog.transaction_timestamp() - interval '45 days')`,
      [
        cohortFixture.id,
        cohortFixture.title,
        actor.actorId,
        actor.pipelineId,
        actor.stageId,
        currency,
      ],
    );
    report.syntheticCohortFixture =
      "private-proposal-with-legacy-baselines-and-one-observed-insert";
  } finally {
    await fixturePool.end();
    report.cleanup.historyFixturePoolClosed = true;
    save();
  }
}

async function verifyCohortPanel(active) {
  const name = active ? "en-persian-observed-cohort" : "en-persian-cohort-no-capture";
  await journey(name, async (page, _context, entry) => {
    const S = copy.en.stats;
    await openDashboard(page, "en", "persian", actor.timeZone);
    const panel = page.getByRole("region", exact(S.cohort.title));
    const cohortAfter = (horizon, action) =>
      rpcAfter(
        page,
        "stats.dealWinCohorts",
        (input) =>
          input.horizon === horizon &&
          input.pipelineId === actor.pipelineId &&
          input.currency === currency &&
          input.calendarIdentity === "persian" &&
          input.timeZoneIdentity === actor.timeZone,
        action,
      );
    const [attention, aging, first] = await Promise.all([
      rpcAfter(
        page,
        "stats.currentAttention",
        (input) => input.pipelineId === actor.pipelineId && input.currency === currency,
        () => {},
      ),
      rpcAfter(
        page,
        "stats.stageAging",
        (input) => input.pipelineId === actor.pipelineId && input.currency === currency,
        () => {},
      ),
      cohortAfter("30-days", () => page.getByRole("tab", exact(S.pipelineTab)).click()),
    ]);
    const attentionPanel = page.getByRole("region", exact(S.currentAttention.title));
    assert.equal(attention.input.from, undefined);
    assert.equal(attention.data.state, "available");
    assert.equal(attention.data.timeZone, actor.timeZone);
    assert.deepEqual(attention.data.counts, {
      overdueActivities: 0,
      dealsWithoutNextStep: active ? 1 : 0,
    });
    assert.deepEqual(Object.keys(attention.data).sort(), [
      "counts",
      "definition",
      "observedAt",
      "state",
      "timeZone",
    ]);
    await attentionPanel
      .getByText(S.currentAttention.dealsWithoutNextStep, { exact: true })
      .waitFor();
    entry.attentionProof = attention.data.counts;
    const agingPanel = page.getByRole("region", exact(S.stageAging.title));
    assert.deepEqual(aging.input.ownerScope, { kind: "me" });
    assert.equal(aging.input.from, undefined);
    assert.deepEqual(first.input.ownerScope, { kind: "me" });
    if (!active) {
      assert.deepEqual(first.data, { state: "coverage-not-started" });
      assert.deepEqual(aging.data, { state: "unavailable", reason: "capture" });
      await agingPanel.getByText(S.stageAging.capture, { exact: true }).waitFor();
      await panel.getByText(S.cohort.noCapture, { exact: true }).waitFor();
      entry.cohortState = first.data.state;
      entry.stageAgingState = aging.data.state;
      return;
    }

    assert.equal(aging.data.state, "available");
    assert.equal(aging.data.currency, currency);
    assert.equal(aging.data.dealCount, 7);
    assert.equal(aging.data.currentOpenDealCount, 1);
    assert.equal(aging.data.rows.length, 1);
    const currentStay = aging.data.rows[0];
    assert.equal(currentStay.stageName, "CI Analytics Stage");
    assert.equal(currentStay.currentOpen.sampleCount, 1);
    assert.equal(currentStay.completed.sampleCount, 0);
    assert.equal(currentStay.leftCensored.currentOpen.sampleCount, 0);
    assert.ok(!JSON.stringify(aging.data).includes(cohortFixture.id));
    await agingPanel.getByRole("heading", exact(currentStay.stageName)).waitFor();
    await agingPanel.scrollIntoViewIfNeeded();
    await capture(page, "en-persian-stage-aging");
    entry.stageAgingProof = {
      deals: aging.data.dealCount,
      openSamples: currentStay.currentOpen.sampleCount,
    };

    assert.equal(first.data.state, "available");
    assert.equal(first.data.population, "current-authorized-live-deals");
    assert.equal(first.data.effectiveOwnerScope, "me");
    assert.equal(first.data.calendar, "persian");
    assert.equal(first.data.timeZone, actor.timeZone);
    assert.equal(first.data.horizonDays, 30);
    assert.equal(first.data.covered.state, "partial");
    assert.equal(first.data.rows.length, 1, "Activation baselines do not create cohort entrants");
    const { calendarMonthStart, ...row } = first.data.rows[0];
    assert.match(calendarMonthStart, /^\d{4}-\d{2}-\d{2}$/);
    assert.deepEqual(row, {
      entered: 1,
      mature: 0,
      immature: 1,
      confirmedWins: 0,
      unknownOutcomes: 0,
      rate: { state: "unavailable", reason: "no-mature-deals" },
    });
    const payload = JSON.stringify(first.data);
    assert.ok(!payload.includes(cohortFixture.id) && !payload.includes(cohortFixture.title));
    await panel.getByText(S.cohort.notMature, { exact: true }).waitFor();
    await panel.scrollIntoViewIfNeeded();
    await capture(page, name);
    const second = await cohortAfter("60-days", () =>
      choose(
        page,
        S.cohort.horizon,
        copy.en.format("_extra.cohortHorizonDays", { count: 60 }),
        panel,
      ),
    );
    assert.equal(second.data.state, "available");
    assert.equal(second.data.horizonDays, 60);
    assert.deepEqual(second.data.rows, first.data.rows);
    await panel.getByText(S.cohort.notMature, { exact: true }).waitFor();
    entry.cohortState = first.data.state;
    entry.cohortProof = { row, calendarMonthStart, horizons: [30, 60] };
  });
}

async function verifyDeviceReportTimeZone() {
  const regional = copy.en.regional;
  const S = copy.en.stats;
  await journey(
    "report-browser-zone-enabled",
    async (page, _context, entry) => {
      phase(entry, "enable-browser-time-zone");
      assert.equal(
        (await page.goto("/settings/regional", { waitUntil: "domcontentloaded" }))?.status(),
        200,
      );
      await csrfReady(page);
      const toggle = page.getByRole("switch", exact(regional.browserTimeZone));
      assert.equal(await toggle.getAttribute("aria-checked"), "false");
      const [response] = await Promise.all([
        page.waitForResponse(
          (candidate) =>
            candidate.url() === `${origin}/settings/regional` &&
            candidate.request().method() === "POST" &&
            Boolean(candidate.request().headers()["next-action"]),
          { timeout: 15000 },
        ),
        toggle.click(),
      ]);
      assert.equal(response.status(), 200);
      await toggle.and(page.locator('[aria-checked="true"]:enabled')).waitFor({ timeout: 7000 });
      const saved = await preferences();
      assert.equal(saved.timezone, actor.timeZone);
      assert.equal(saved.ui.localePreferences?.timeZoneMode, "browser");
      entry.accountTimeZone = saved.timezone;
    },
    { timezoneId: actor.timeZone },
  );

  const deviceTimeZone = "America/Los_Angeles";
  await journey(
    "report-current-device-zone",
    async (page, context, entry) => {
      phase(entry, "open-report-on-second-device");
      await context.addCookies([
        { name: "warpdrive_timezone", value: deviceTimeZone, url: origin },
        { name: "warpdrive_timezone_mode", value: "browser", url: origin },
      ]);
      const dashboardResult = await openDashboard(page, "en", "persian", deviceTimeZone);
      const cohortResult = await rpcAfter(
        page,
        "stats.dealWinCohorts",
        (input) => input.timeZoneIdentity === deviceTimeZone && input.horizon === "30-days",
        () => page.getByRole("tab", exact(S.pipelineTab)).click(),
      );
      assert.equal(dashboardResult.data.timeZone, deviceTimeZone);
      assert.equal(cohortResult.data.state, "available");
      assert.equal(cohortResult.data.timeZone, deviceTimeZone);
      assert.equal(cohortResult.data.calendar, "persian");
      await page
        .getByRole("region", exact(S.cohort.title))
        .getByText(deviceTimeZone, { exact: true })
        .waitFor();
      const saved = await preferences();
      assert.equal(
        saved.timezone,
        actor.timeZone,
        "Device cookie did not replace the account zone",
      );
      assert.equal(saved.ui.localePreferences?.timeZoneMode, "browser");
      entry.accountTimeZone = saved.timezone;
      entry.dashboardTimeZone = dashboardResult.data.timeZone;
      entry.cohortTimeZone = cohortResult.data.timeZone;
    },
    { timezoneId: deviceTimeZone },
  );
}

try {
  assert.match(report.revision, /^[0-9a-f]{40}$/);
  const readOnly = await pool.query("SHOW default_transaction_read_only");
  assert.equal(readOnly.rows[0].default_transaction_read_only, "on");
  const original = await preferences();
  assert.equal(original.timezone, actor.timeZone);
  assert.deepEqual(
    original.ui.localePreferences,
    actor.regional,
    "The synthetic analytics actor starts from a stable manual regional profile",
  );
  const { rows: seeded } = await pool.query(
    `SELECT d.id,d.currency,d.owner_id,d.visibility_level,d.pipeline_id,
            p.visibility_group_id,p.is_archived,
            to_char(d.won_time AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
            EXISTS (SELECT 1 FROM visibility_group_members m
                     WHERE m.group_id=p.visibility_group_id AND m.user_id=$2) AS group_member
       FROM deals d JOIN pipelines p ON p.id=d.pipeline_id
       WHERE d.pipeline_id=ANY($1::uuid[]) ORDER BY d.id`,
    [[actor.pipelineId, actor.restrictedPipelineId], actor.actorId],
  );
  assert.deepEqual(
    seeded.map((row) => row.id),
    Object.values(deals)
      .map((row) => row.id)
      .sort(),
  );
  const find = (key) => seeded.find((row) => row.id === deals[key].id);
  const boundary = find("boundary");
  currency = boundary.currency;
  assert.equal(currency, "EUR", "Uses the hosted seed's EUR report currency");
  assert.equal(boundary.owner_id, actor.actorId);
  assert.notEqual(find("otherCurrency").currency, currency);
  assert.notEqual(find("otherOwner").owner_id, actor.actorId);
  assert.equal(find("otherOwner").visibility_level, "all");
  assert.notEqual(find("hidden").owner_id, actor.actorId);
  assert.equal(find("hidden").visibility_level, "owner");
  const restricted = find("restricted");
  assert.equal(restricted.owner_id, actor.actorId);
  assert.equal(restricted.currency, currency);
  assert.equal(restricted.day, find("recorded").day);
  assert.equal(restricted.pipeline_id, actor.restrictedPipelineId);
  assert.equal(restricted.visibility_group_id, actor.restrictedGroupId);
  assert.equal(restricted.is_archived, false);
  assert.equal(restricted.group_member, false);

  browser = await chromium.launch({ headless: true });
  report.browserVersion = browser.version();
  await journey("native-login", async (page, context) => {
    const regional = actor.regional;
    await context.addCookies(
      Object.entries({
        warpdrive_locale: regional.locale,
        warpdrive_calendar: regional.calendar,
        warpdrive_timezone: regional.timeZone,
        warpdrive_country: regional.country,
        warpdrive_timezone_mode: regional.timeZoneMode,
        warpdrive_numbering_system: regional.numberingSystem,
      }).map(([name, value]) => ({ name, value, url: origin })),
    );
    await page.goto("/login");
    await page.locator('input[name="email"]').fill(actor.email);
    await page.locator('input[name="password"]').fill(actor.password);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL((url) => !/^\/(login|auth)(\/|$)/.test(url.pathname));
    assert.equal(
      (await page.goto("/settings/regional", { waitUntil: "domcontentloaded" }))?.status(),
      200,
    );
    assert.equal(new URL(page.url()).pathname, "/settings/regional");
    await csrfReady(page);
    session = await context.storageState();
    report.nativeLogins += 1;
  });

  await verifyRestrictedPipeline();
  await verifyRecordedDealSources();
  await verifyLeadHandoff();
  await verifySavedPerformance();
  await verifyDealReportDownload();
  await matrix("en", "gregory");
  await setRegional("en", "timeZone", "UTC", {
    locale: "en",
    calendar: "gregory",
    timeZone: "UTC",
  });
  await verifyZoneBoundary("UTC", boundary.day, true);
  await setRegional("en", "timeZone", "America/Los_Angeles", {
    locale: "en",
    calendar: "gregory",
    timeZone: "America/Los_Angeles",
  });
  await verifyZoneBoundary("America/Los_Angeles", boundary.day, false);
  await setRegional("en", "timeZone", actor.timeZone, {
    locale: "en",
    calendar: "gregory",
    timeZone: actor.timeZone,
  });
  await setRegional("en", "locale", languages.de, {
    locale: "de",
    calendar: "gregory",
    timeZone: actor.timeZone,
  });
  await matrix("de", "gregory");
  await setRegional("de", "locale", languages.fa, {
    locale: "fa",
    calendar: "gregory",
    timeZone: actor.timeZone,
  });
  await journey(
    "fa-gregorian-presets",
    async (page, _context, entry) => {
      const current = await openDashboard(page, "fa", "gregory", actor.timeZone);
      await exercisePresets(page, "fa", "gregory", current, entry);
    },
    { viewport: mobile },
  );
  await setRegional("fa", "calendar", copy.fa.regional.persianCalendar, {
    locale: "fa",
    calendar: "persian",
    timeZone: actor.timeZone,
  });
  await matrix("fa", "persian");
  await setRegional("fa", "locale", languages.en, {
    locale: "en",
    calendar: "persian",
    timeZone: actor.timeZone,
  });
  await journey("en-persian-presets", async (page, _context, entry) => {
    const current = await openDashboard(page, "en", "persian", actor.timeZone);
    await exercisePresets(page, "en", "persian", current, entry);
  });
  await verifyCohortPanel(false);
  await activateSyntheticCohort();
  await verifyCohortPanel(true);
  await verifyDeviceReportTimeZone();
  assert.equal(report.nativeLogins, 1);
  assert.equal(asynchronousFailure, false);
  report.state = "PASS";
} catch (error) {
  report.state = "FAIL";
  report.error = safeError(error);
  process.exitCode = 1;
} finally {
  session = undefined;
  report.cleanup.sessionCleared = true;
  try {
    if (browser) await browser.close();
    report.cleanup.browserClosed = true;
  } catch (error) {
    report.state = "FAIL";
    report.cleanup.browserError = safeError(error);
    process.exitCode = 1;
  } finally {
    try {
      await pool.end();
      report.cleanup.databasePoolClosed = true;
    } catch (error) {
      report.state = "FAIL";
      report.cleanup.databaseError = safeError(error);
      process.exitCode = 1;
    } finally {
      save();
    }
  }
}
if (report.state === "PASS") console.log("Analytics browser qualification passed");
else
  console.error(
    `Analytics browser qualification failed; inspect the receipt at ${file("receipt.json")}`,
  );
