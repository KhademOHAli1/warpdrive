import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPreferenceProbe } from "./browser-appearance-actions.mjs";

// Admission precedes DB/browser imports. Never run against an operator's local session/database.
if (
  process.env.GITHUB_ACTIONS !== "true" ||
  process.env.CI !== "true" ||
  process.env.NODE_ENV !== "production"
) {
  throw new Error("Appearance validation requires the disposable production GitHub runner");
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
const actor = "00000000-0000-4000-8000-000000000501";
const sentinel = "00000000-0000-4000-8000-000000000505";
const evidence = new URL("../test-results/browser-smoke/appearance/", import.meta.url);
mkdirSync(evidence, { recursive: true });
const report = {
  state: "RUNNING",
  revision: process.env.APP_COMMIT,
  buildId: readFileSync(new URL("../.next/BUILD_ID", import.meta.url), "utf8").trim(),
  browser: "Chromium",
  criteria:
    "#866 AC1: actual autosave and deliberate density Save feedback, recovery and persistence",
  limits:
    "Live-region markup and accessibility snapshots; actual screen-reader speech and human acceptance are unrun. No provider, release or deployment qualification.",
  journeys: [],
  nativeLogins: [],
  unhandledErrors: [],
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
// Keep isolated journey contexts while sharing only a genuine native session in memory.
// This leaves the combined smoke packs below the unchanged sign-in rate limit.
const nativeSessions = new Map();

// A late library callback rejection must fail both the process and its retained receipt.
process.on("unhandledRejection", (error) => {
  fatal ??= asError(error);
  report.state = "FAIL";
  report.unhandledErrors.push({
    name: error instanceof Error ? error.name : "NonErrorRejection",
    message:
      error instanceof Error && error.message === "Route is already handled!"
        ? error.message
        : "Unhandled asynchronous browser harness rejection",
  });
  process.exitCode = 1;
  writeFileSync(new URL("receipt.json", evidence), JSON.stringify(report, null, 2));
});

function catalog(path) {
  return JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
}

function asError(error) {
  return error instanceof Error
    ? error
    : new Error("Appearance validation failed with a non-Error", { cause: error });
}

async function drainContextRoutes(context) {
  let timer;
  try {
    await Promise.race([
      context.unrouteAll({ behavior: "wait" }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Owned context routes did not drain")), 10_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function snapshot() {
  const { rows } = await pool.query(
    "SELECT user_id, timezone, density, ui, updated_at FROM user_preferences ORDER BY user_id",
  );
  assert.ok(
    rows.some((row) => row.user_id === sentinel),
    "Nonvacuous other-actor witness",
  );
  const own = rows.find((row) => row.user_id === actor);
  assert.ok(own, "Seeded actor preference row");
  assert.equal(own.timezone, "Europe/Berlin");
  assert.equal(own.ui.winSound, true);
  assert.equal(own.ui.dailyActivityTarget, 7);
  return { own, other: rows.filter((row) => row.user_id !== actor) };
}

function verifyStored(before, after, kind, value, unchanged = false) {
  assert.deepEqual(after.other, before.other, "Other actors remain unchanged");
  if (unchanged) {
    assert.deepEqual(
      after.own,
      before.own,
      "Denied/aborted/draft/no-op attempt does not mutate preferences",
    );
    return;
  }
  const { updated_at: beforeUpdated, ...expected } = structuredClone(before.own);
  const { updated_at: afterUpdated, ...actual } = after.own;
  assert.ok(beforeUpdated instanceof Date && afterUpdated instanceof Date);
  if (kind === "appearance") expected.ui.appearance = value;
  else expected.density = value;
  assert.deepEqual(actual, expected, "Only the requested preference changed");
}

async function login(page) {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill("browser@example.invalid");
  await page.locator('input[name="password"]').fill("CI-browser-only-password-2026!");
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((url) => !/^\/(login|auth)(\/|$)/.test(url.pathname));
  const response = await page.goto("/settings/appearance");
  assert.equal(response.status(), 200);
}

async function live(page, label, role, text, entry, density = false) {
  const region = page.getByRole(role, { name: label, exact: true });
  await region.filter({ hasText: text }).waitFor({ state: "visible" });
  assert.equal(await region.count(), 1, "One local announcement region per card and role");
  assert.equal((await region.textContent()).trim(), text);
  assert.equal(await region.getAttribute("aria-atomic"), "true");
  const other = page.getByRole(role === "status" ? "alert" : "status", {
    name: label,
    exact: true,
  });
  assert.equal(
    (await other.textContent()).trim(),
    "",
    "No simultaneous contradictory success/failure",
  );
  entry.announcements.push({
    label,
    role,
    text,
    accessibilitySnapshot: await region.ariaSnapshot(),
  });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    true,
    "Feedback fits the viewport",
  );
  assert.equal(
    await region.evaluate((el) => {
      const box = el.getBoundingClientRect();
      return box.left >= -1 && box.right <= innerWidth + 1 && el.scrollWidth <= el.clientWidth + 1;
    }),
    true,
    "Feedback text is neither horizontally clipped nor outside the viewport",
  );
  if (density && entry.viewport.width < 640) {
    const layout = await region.evaluate((el) => {
      const footer = el.parentElement?.parentElement?.parentElement;
      const button = footer?.querySelector("button");
      if (!footer || !button) return null;
      const style = getComputedStyle(footer);
      return {
        width: el.getBoundingClientRect().width,
        available:
          footer.clientWidth -
          Number.parseFloat(style.paddingInlineStart) -
          Number.parseFloat(style.paddingInlineEnd),
        below: button.getBoundingClientRect().top >= el.getBoundingClientRect().bottom - 1,
      };
    });
    assert.ok(layout, "Density footer and its existing Save/Retry control are present");
    assert.ok(
      layout.width >= layout.available - 1,
      "Mobile density feedback uses the available card width",
    );
    assert.equal(
      layout.below,
      true,
      "Mobile Save/Retry sits below the feedback instead of squeezing its text",
    );
  }
  if (role === "alert") {
    await page.screenshot({
      path: fileURLToPath(
        new URL(
          `${entry.locale}-${entry.viewport.width}-${entry.colorScheme}-${entry.scenario}-alert-${entry.announcements.length}.png`,
          evidence,
        ),
      ),
      fullPage: true,
    });
  }
}

async function paint(page, value) {
  await page.waitForFunction((appearance) => {
    const dark =
      appearance === "night" ||
      (appearance === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    const cookie = document.cookie.split("; ").find((item) => item.startsWith("wd_appearance="));
    return (
      cookie === `wd_appearance=${appearance}` &&
      document.documentElement.classList.contains("dark") === dark
    );
  }, value);
}

async function dismissError(page, entry) {
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ state: "visible" });
  entry.globalDialogs.push(await dialog.ariaSnapshot());
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
}

function controls(page, L, options) {
  const theme = page.getByRole("combobox", { name: L._hierarchy.theme, exact: true });
  return {
    theme,
    density: page.locator("[data-density]").first(),
    save: () => page.getByRole("button", { name: L.save, exact: true }),
    radio: (value) => page.getByRole("radio", { name: L[value], exact: true }),
    async pick(value) {
      await theme.click();
      await page.getByRole("option", { name: options[value], exact: true }).click();
    },
  };
}

async function action(s, { kind, value, ok = true, transportAbort = false, start }) {
  const before = await snapshot();
  const hold = s.probe.expect({ kind, value, ok, transportAbort });
  await start();
  const observed = await hold.reached();
  const after = await snapshot();
  verifyStored(before, after, kind, value, !ok || transportAbort);
  s.entry.databaseChecks.push({
    kind,
    value,
    outcome: observed.outcome,
    before: before.own,
    held: after.own,
    otherActorsUnchanged: true,
  });
  const label = kind === "appearance" ? s.L._hierarchy.theme : s.L.density;
  const prefix = kind === "appearance" ? "theme" : "density";
  await live(s.page, label, "status", s.F[`${prefix}Saving`], s.entry, kind === "density");
  if (kind === "appearance") await paint(s.page, value);
  else {
    assert.equal(
      await s.c.density.getAttribute("data-density"),
      before.own.density,
      "Density applies after Save acknowledgment",
    );
    assert.equal(await s.c.radio(value).isDisabled(), true);
  }
  hold.release();
  await hold.delivered();
  if (!ok || transportAbort) {
    await dismissError(s.page, s.entry);
    await live(s.page, label, "alert", s.F[`${prefix}Error`], s.entry, kind === "density");
    if (kind === "appearance") await paint(s.page, before.own.ui.appearance);
    else {
      assert.equal(await s.c.radio(value).isChecked(), true, "Failed density draft is retained");
      assert.equal(await s.c.density.getAttribute("data-density"), before.own.density);
    }
  } else {
    await live(s.page, label, "status", s.F[`${prefix}Saved`], s.entry, kind === "density");
    if (kind === "density") {
      await s.page.waitForFunction(
        (density) =>
          document.querySelector("[data-density]")?.getAttribute("data-density") === density,
        value,
      );
      assert.equal(
        await s.c.save().isDisabled(),
        true,
        "Acknowledged density Save is unchanged and disabled",
      );
    }
  }
  s.probe.assertHealthy();
}

async function keyboardRetry(s, kind, value) {
  const name = s.F[kind === "appearance" ? "themeRetry" : "densityRetry"];
  await action(s, {
    kind,
    value,
    start: async () => {
      await s.page.getByRole("button", { name, exact: true }).focus();
      await s.page.keyboard.press("Enter");
      if (kind === "appearance") {
        assert.equal(
          await s.c.theme.evaluate((el) => document.activeElement === el),
          true,
          "Theme Retry focus survives removal of its button",
        );
      }
    },
  });
}

async function csrfFailure(s, kind, value, start) {
  const csrf = (await s.context.cookies(origin)).filter((cookie) => cookie.name === "wd_csrf");
  assert.equal(csrf.length, 1);
  assert.equal(csrf[0].httpOnly, false);
  try {
    await s.context.clearCookies({
      name: csrf[0].name,
      domain: csrf[0].domain,
      path: csrf[0].path,
    });
    await action(s, { kind, value, ok: false, start });
  } finally {
    await s.context.addCookies(csrf);
  }
  await keyboardRetry(s, kind, value);
}

async function draftDensity(s, value) {
  const before = await snapshot();
  const count = s.probe.actions.length;
  await s.c.radio(value).click();
  assert.equal(await s.c.radio(value).isChecked(), true);
  assert.equal(await s.c.density.getAttribute("data-density"), before.own.density);
  verifyStored(before, await snapshot(), "density", value, true);
  assert.equal(s.probe.actions.length, count, "Draft selection does not send a server action");
  assert.equal(await s.c.save().isEnabled(), true);
}

async function reloadStored(s) {
  const stored = await snapshot();
  const response = await s.page.reload();
  assert.equal(response.status(), 200);
  await s.c.theme.filter({ hasText: s.options[stored.own.ui.appearance] }).waitFor();
  await paint(s.page, stored.own.ui.appearance);
  await s.page.waitForFunction(
    (density) => document.querySelector("[data-density]")?.getAttribute("data-density") === density,
    stored.own.density,
  );
  assert.equal(await s.c.save().isDisabled(), true, "Unchanged Save stays disabled after reload");
  verifyStored(stored, await snapshot(), "density", stored.own.density, true);
  assert.equal(
    await s.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    true,
    "No horizontal overflow",
  );
  s.entry.reloadPersisted = { appearance: stored.own.ui.appearance, density: stored.own.density };
}

async function recovery(s) {
  let initial = await snapshot();
  const desiredTheme = s.entry.colorScheme === "dark" ? "night" : "day";
  if (initial.own.ui.appearance !== desiredTheme) {
    await action(s, {
      kind: "appearance",
      value: desiredTheme,
      start: () => s.c.pick(desiredTheme),
    });
    initial = await snapshot();
  }
  const setupActions = s.probe.actions.length;
  assert.equal(await s.c.save().isDisabled(), true);
  const first = initial.own.ui.appearance === "night" ? "day" : "night";
  const second = first === "night" ? "day" : "night";
  await action(s, { kind: "appearance", value: first, start: () => s.c.pick(first) });
  await csrfFailure(s, "appearance", second, () => s.c.pick(second));
  const density = initial.own.density === "comfortable" ? "compact" : "comfortable";
  await draftDensity(s, density);
  await csrfFailure(s, "density", density, () => s.c.save().click());
  assert.equal(await s.c.radio(density).isChecked(), true);
  await reloadStored(s);
  assert.equal(
    s.probe.actions.length,
    setupActions + 5,
    "Only the setup and five requested preference actions occurred",
  );
}

async function transport(s) {
  const initial = await snapshot();
  const appearance = initial.own.ui.appearance === "night" ? "day" : "night";
  await action(s, {
    kind: "appearance",
    value: appearance,
    transportAbort: true,
    start: () => s.c.pick(appearance),
  });
  await paint(s.page, initial.own.ui.appearance);
  await keyboardRetry(s, "appearance", appearance);
  const density = initial.own.density === "comfortable" ? "compact" : "comfortable";
  await draftDensity(s, density);
  await action(s, {
    kind: "density",
    value: density,
    transportAbort: true,
    start: () => s.c.save().click(),
  });
  assert.equal(await s.c.radio(density).isChecked(), true);
  await keyboardRetry(s, "density", density);
  await reloadStored(s);
  assert.equal(s.probe.actions.length, 4);
}

async function ordering(s, denied) {
  const before = await snapshot();
  const first = before.own.ui.appearance === "night" ? "day" : "night";
  const csrf = (await s.context.cookies(origin)).filter((cookie) => cookie.name === "wd_csrf");
  assert.equal(csrf.length, 1);
  if (denied)
    await s.context.clearCookies({
      name: csrf[0].name,
      domain: csrf[0].domain,
      path: csrf[0].path,
    });
  try {
    const one = s.probe.expect({ kind: "appearance", value: first, ok: !denied });
    await s.c.pick(first);
    await one.reached();
    const held = await snapshot();
    verifyStored(before, held, "appearance", first, denied);
    await s.context.addCookies(csrf);
    const two = s.probe.expect({ kind: "appearance", value: "system", ok: true });
    await s.c.pick("system");
    await paint(s.page, "system");
    assert.equal(s.probe.actions.length, 1, "New theme write waits for the in-flight action");
    one.release();
    await one.delivered();
    await two.reached();
    const systemHeld = await snapshot();
    verifyStored(held, systemHeld, "appearance", "system");
    await live(s.page, s.L._hierarchy.theme, "status", s.F.themeSaving, s.entry);
    assert.equal(
      await s.page.getByRole("dialog").count(),
      0,
      "Stale denial does not open a dialog",
    );
    assert.equal(
      await s.page.getByRole("button", { name: s.F.themeRetry, exact: true }).count(),
      0,
    );
    two.release();
    await two.delivered();
    await live(s.page, s.L._hierarchy.theme, "status", s.F.themeSaved, s.entry);
    const count = s.probe.actions.length;
    for (const colorScheme of ["dark", "light"]) {
      await s.page.emulateMedia({ colorScheme });
      await paint(s.page, "system");
    }
    assert.equal(
      s.probe.actions.length,
      count,
      "System media changes do not persist a different preference",
    );
    verifyStored(systemHeld, await snapshot(), "appearance", "system", true);
    s.entry.databaseChecks.push({
      kind: "ordering",
      firstDenied: denied,
      before: before.own,
      firstHeld: held.own,
      systemHeld: systemHeld.own,
      otherActorsUnchanged: true,
    });
    await reloadStored(s);
    assert.equal(s.probe.actions.length, 2);
  } finally {
    await s.context.addCookies(csrf);
  }
}

function watchNetwork(context, page, entry) {
  const errors = [];
  const unexpected = [];
  const postCancellations = [];
  let preferenceProbe;
  entry.navigationCancellations = [];
  entry.fulfilledResponseCancellations = [];
  let expectedTransportErrors = 0;
  page.on("requestfailed", (request) => {
    const url = new URL(request.url());
    const detail = {
      path: url.pathname,
      method: request.method(),
      failure: request.failure()?.errorText,
      navigation: request.isNavigationRequest(),
      rsc: request.headers().rsc === "1",
    };
    // Explicit navigation/reload legitimately cancels the superseded document or RSC fetch.
    // Keep each observation; all other failed GETs and every unexpected POST still fail.
    if (
      url.origin === origin &&
      detail.method === "GET" &&
      detail.failure === "net::ERR_ABORTED" &&
      (detail.navigation || detail.rsc)
    ) {
      entry.navigationCancellations.push(detail);
      return;
    }
    if (
      url.origin === origin &&
      url.pathname === "/settings/appearance" &&
      detail.method === "POST" &&
      request.headers()["next-action"] &&
      detail.failure === "net::ERR_ABORTED"
    ) {
      // Classify after all held responses settle, using this exact Request object's custody.
      postCancellations.push({ request, detail });
      return;
    }
    if (
      url.origin === origin &&
      url.pathname === "/settings/appearance" &&
      request.method() === "POST" &&
      request.headers()["next-action"] &&
      request.failure()?.errorText === "net::ERR_FAILED"
    ) {
      expectedTransportErrors += 1;
    } else errors.push(detail);
  });
  page.on("pageerror", (error) => errors.push(error.name));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (
      message.text() === "Failed to load resource: net::ERR_FAILED" &&
      message.location().url === `${origin}/settings/appearance`
    )
      return;
    errors.push(message.text());
  });
  const ready = Promise.all([
    context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const preference =
        url.pathname === "/settings/appearance" &&
        request.method() === "POST" &&
        request.headers()["next-action"];
      if (url.origin !== origin) {
        unexpected.push(url.origin);
        await route.abort("blockedbyclient");
      } else if (preference) {
        if (!preferenceProbe) {
          errors.push({ path: url.pathname, error: "Preference action before probe attachment" });
          await route.abort("blockedbyclient");
        } else {
          assert.equal(preferenceProbe.matches(request), true);
          await preferenceProbe.handle(route);
        }
      } else {
        await route.continue();
      }
    }),
    context.routeWebSocket("**/*", (socket) => {
      unexpected.push(new URL(socket.url()).origin);
      return socket.close({ code: 1008, reason: "No sockets in appearance validation" });
    }),
  ]);
  return {
    ready,
    attach(probe) {
      assert.equal(preferenceProbe, undefined, "Only one preference probe owns this context");
      preferenceProbe = probe;
    },
    verify(expectedAborts, probe) {
      for (const { request, detail } of postCancellations) {
        const delivered = probe.deliveredObservation(request);
        if (delivered) entry.fulfilledResponseCancellations.push({ ...detail, delivered });
        else errors.push(detail);
      }
      entry.expectedTransportErrors = expectedTransportErrors;
      entry.unexpectedNetworkFailures = errors;
      entry.unexpectedOrigins = unexpected;
      assert.equal(expectedTransportErrors, expectedAborts);
      assert.deepEqual(errors, [], "No unexpected browser errors");
      assert.deepEqual(unexpected, [], "No external requests or sockets");
    },
  };
}

async function journey(locale, width, colorScheme, scenario, exercise) {
  const entry = {
    locale,
    viewport: { width, height: 900 },
    colorScheme,
    scenario,
    state: "RUNNING",
    announcements: [],
    globalDialogs: [],
    databaseChecks: [],
    contextClosed: false,
    sessionReused: nativeSessions.has(locale),
  };
  report.journeys.push(entry);
  const context = await browser.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
    serviceWorkers: "block",
    viewport: entry.viewport,
    colorScheme,
    storageState: structuredClone(nativeSessions.get(locale)),
  });
  context.setDefaultTimeout(5000);
  context.setDefaultNavigationTimeout(15000);
  let probe;
  let page;
  let problem;
  let network;
  try {
    page = await context.newPage();
    network = watchNetwork(context, page, entry);
    await network.ready;
    await context.addCookies([{ name: "warpdrive_locale", value: locale, url: origin }]);
    if (!nativeSessions.has(locale)) {
      await login(page);
      nativeSessions.set(locale, await context.storageState());
      report.nativeLogins.push({ locale, method: "password", storage: "memory-only" });
    } else {
      assert.equal((await page.goto("/settings/appearance")).status(), 200);
    }
    assert.equal(await page.locator("html").getAttribute("lang"), locale);
    assert.equal(await page.locator("html").getAttribute("dir"), locale === "fa" ? "rtl" : "ltr");
    const L = catalog(`src/features/identity/messages/settings.${locale}.json`);
    const options = catalog(`src/components/shell/messages/shell.${locale}.json`).appearance;
    const c = controls(page, L, options);
    await c.theme.waitFor();
    probe = createPreferenceProbe(page, { origin });
    network.attach(probe);
    await exercise({
      page,
      context,
      probe,
      c,
      L,
      F: L._hierarchy.appearanceFeedback,
      options,
      entry,
    });
    probe.assertHealthy();
    entry.actions = probe.actions;
    await page.screenshot({
      path: fileURLToPath(new URL(`${locale}-${width}-${colorScheme}-${scenario}.png`, evidence)),
      fullPage: true,
    });
  } catch (error) {
    entry.state = "FAIL";
    entry.error = String(error);
    problem = asError(error);
    if (page) {
      await page
        .screenshot({ path: fileURLToPath(new URL("failure.png", evidence)), fullPage: true })
        .catch(() => {});
    }
  } finally {
    try {
      try {
        try {
          if (probe) await probe.close();
        } finally {
          await drainContextRoutes(context);
        }
        if (network && probe) {
          probe.assertHealthy();
          network.verify(scenario === "transport" ? 2 : 0, probe);
        }
        if (fatal instanceof Error) problem ??= fatal;
      } finally {
        await context.close();
        entry.contextClosed = true;
      }
      if (problem instanceof Error) {
        entry.state = "FAIL";
        entry.error = String(problem);
      } else entry.state = "PASS";
    } catch (error) {
      entry.state = "FAIL";
      entry.error = String(error);
      problem ??= asError(error);
    } finally {
      writeFileSync(new URL("receipt.json", evidence), JSON.stringify(report, null, 2));
    }
  }
  if (problem instanceof Error) throw problem;
  console.log(`appearance-${locale}-${width}-${colorScheme}-${scenario}: passed`);
}

try {
  const readOnly = await pool.query("SHOW default_transaction_read_only");
  assert.equal(readOnly.rows[0].default_transaction_read_only, "on");
  browser = await chromium.launch({ headless: true });
  report.browserVersion = browser.version();
  for (const locale of ["en", "de", "fa"]) {
    for (const width of [1280, 390]) {
      for (const colorScheme of ["light", "dark"]) {
        await journey(locale, width, colorScheme, "recovery", recovery);
      }
    }
  }
  await journey("en", 1280, "light", "transport", transport);
  await journey("en", 1280, "light", "ordering-success", (s) => ordering(s, false));
  await journey("en", 1280, "dark", "ordering-denial", (s) => ordering(s, true));
  assert.equal(report.nativeLogins.length, 3);
  assert.equal(report.journeys.filter((entry) => entry.sessionReused).length, 12);
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
      writeFileSync(new URL("receipt.json", evidence), JSON.stringify(report, null, 2));
    }
  }
}
if (fatal instanceof Error) throw fatal;
