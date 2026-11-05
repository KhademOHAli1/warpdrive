import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "../tools/browser-smoke/node_modules/playwright/index.mjs";

// Disposable synthetic data only: no provider requests, mailbox connection or live workflow runs.
const origin = "https://127.0.0.1:3443";
const pipeline = "/pipeline/00000000-0000-4000-8000-000000000503";
const catalog = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const sales = catalog("src/features/deals/messages/sales.en.json");
const calendar = catalog("src/features/activities/messages/calendar.en.json");
const workflows = catalog("src/features/workflows/messages/workflows.en.json");
const entityCreate = catalog("src/features/entity-create/messages/entityCreate.en.json");
const mail = catalog("src/features/email/connections/messages/mailConnections.en.json");
const browser = await chromium.launch({ headless: true });

async function journey(name, locale, exercise, viewport) {
  const context = await browser.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
    serviceWorkers: "block",
    ...(viewport ? { viewport } : {}),
  });
  context.setDefaultTimeout(15_000);
  const errors = [];
  const unexpectedRequests = [];
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    unexpectedRequests.push(url.origin);
    return route.abort("blockedbyclient");
  });
  // Never connect to a socket server. Realtime is disabled by the existing empty client URL
  // configuration; every attempted socket is still blocked locally and fails this journey.
  await context.routeWebSocket("**/*", (socket) => {
    unexpectedRequests.push(new URL(socket.url()).origin);
    return socket.close({ code: 1008, reason: "No WebSockets in browser smoke" });
  });
  await context.addCookies([{ name: "warpdrive_locale", value: locale, url: origin }]);
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  try {
    await exercise(page);
    assert.deepEqual(errors, [], `${name}: browser errors`);
    assert.deepEqual(unexpectedRequests, [], `${name}: unexpected external requests`);
    await context.tracing.stop();
    console.log(`${name}: passed`);
  } catch (error) {
    const evidence = new URL(`../test-results/browser-smoke/${name}/`, import.meta.url);
    mkdirSync(evidence, { recursive: true });
    writeFileSync(
      new URL("errors.json", evidence),
      JSON.stringify(
        {
          error: String(error),
          errors,
          unexpectedRequests,
        },
        null,
        2,
      ),
    );
    await page
      .screenshot({ path: fileURLToPath(new URL("failure.png", evidence)), fullPage: true })
      .catch(() => {});
    await context.tracing
      .stop({ path: fileURLToPath(new URL("trace.zip", evidence)) })
      .catch(() => {});
    throw error;
  } finally {
    await context.close();
  }
}

async function login(page) {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill("browser@example.invalid");
  await page.locator('input[name="password"]').fill("CI-browser-only-password-2026!");
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((url) => !/^\/(login|auth)(\/|$)/.test(url.pathname));
  await page.getByRole("main", { name: "Board CI Pipeline", exact: true }).waitFor();
}

try {
  for (const [locale, heading, language] of [
    ["en", "Sign in to Warpdrive", "Language"],
    ["de", "Bei Warpdrive anmelden", "Sprache"],
    ["fa", "ورود به Warpdrive", "زبان"],
  ]) {
    await journey(`public-${locale}`, locale, async (page) => {
      const response = await page.goto(`${origin}/login`, { waitUntil: "networkidle" });
      assert.equal(response?.status(), 200);
      await page.getByRole("heading", { name: heading, exact: true }).waitFor();
      assert.equal(await page.locator("html").getAttribute("lang"), locale);
      assert.equal(await page.locator("html").getAttribute("dir"), locale === "fa" ? "rtl" : "ltr");
      const email = page.locator('input[name="email"]');
      await email.waitFor(); // Requires the real providers API and React hydration.
      await email.fill("browser-smoke@example.invalid");
      assert.equal(await email.inputValue(), "browser-smoke@example.invalid");
      await page.getByRole("button", { name: language, exact: true }).click();
      await page.getByRole("menuitemradio").first().waitFor();
      assert.equal(await page.getByRole("menuitemradio").count(), 3);
      await page.keyboard.press("Escape");
      for (const route of ["/inbox", "/deals", "/settings/email"]) {
        await page.goto(`${origin}${route}`, { waitUntil: "networkidle" });
        assert.equal(
          new URL(page.url()).pathname,
          "/login",
          `${locale}: ${route} must require login`,
        );
        await page.getByRole("heading", { name: heading, exact: true }).waitFor();
      }
    });
  }

  for (const locale of ["fa", "de"]) {
    await journey(
      `mobile-${locale}`,
      locale,
      async (page) => {
        await page.goto("/login");
        assert.equal(await page.locator("html").getAttribute("lang"), locale);
        await page.locator('input[name="email"]').waitFor();
        await page.locator('input[name="password"]').waitFor();
        if (locale === "fa") assert.equal(await page.locator("html").getAttribute("dir"), "rtl");
      },
      { width: 390, height: 844 },
    );
  }

  await journey("deal-persistence", "en", async (page) => {
    await login(page);
    await page.goto(pipeline);
    await page
      .getByRole("main", { name: "Board CI Pipeline", exact: true })
      .getByRole("status")
      .getByRole("button", { name: sales.deal_96653, exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByRole("textbox", { name: sales.deal_title_95b14, exact: true })
      .fill("CI persisted deal");
    await dialog.getByRole("button", { name: entityCreate.save, exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    await page.goto(pipeline);
    await page.getByText("CI persisted deal", { exact: true }).waitFor();
    await page.reload();
    await page.getByText("CI persisted deal", { exact: true }).waitFor();
  });

  await journey("calendar-persistence", "en", async (page) => {
    await login(page);
    await page.goto("/activities/calendar");
    await page.getByRole("button", { name: calendar.editor.create, exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByRole("textbox", { name: calendar.editor.eventTitle, exact: true })
      .fill("CI persisted event");
    await dialog.locator('button[type="submit"]').click();
    await dialog.waitFor({ state: "hidden" });
    await page.reload();
    await page.getByText("CI persisted event", { exact: true }).first().waitFor();
  });

  await journey("mailbox-setup-cancel", "en", async (page) => {
    await login(page);
    await page.goto("/settings/email-sync");
    await page.getByText(mail.empty, { exact: true }).waitFor();
    await page.getByRole("button", { name: mail.add, exact: true }).click();
    await page.getByRole("dialog").waitFor();
    await page.keyboard.press("Escape");
    await page.reload();
    await page.getByText(mail.empty, { exact: true }).waitFor();
  });

  await journey("workflow-draft-persistence", "en", async (page) => {
    await login(page);
    await page.goto("/workflows");
    await page.getByRole("button", { name: workflows.new, exact: true }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByRole("textbox", { name: workflows.name, exact: true })
      .fill("CI follow-up draft");
    await dialog.getByRole("button", { name: workflows.create, exact: true }).click();
    await page.waitForURL(/\/workflows\/[0-9a-f-]+$/);
    await page.getByRole("button", { name: "Add step", exact: true }).first().click();
    await page.getByRole("button", { name: "Code", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Source code", exact: true })
      .fill("export function main(): { calculated: number } { return { calculated: 42 }; }");
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await page.getByText("Draft · Revision 2", { exact: true }).waitFor();
    await page.reload();
    await page.getByRole("group", { name: "Code", exact: true }).waitFor();
    await page.getByRole("button", { name: "Safe test", exact: true }).click();
    await page.getByText("Evaluated", { exact: true }).waitFor();
    await page.getByText("42", { exact: true }).waitFor();
    await page.goto("/workflows");
    await page.getByRole("link", { name: /CI follow-up draft/ }).waitFor();
    await page.reload();
    await page.getByRole("link", { name: /CI follow-up draft/ }).waitFor();
  });
  await journey("goals-list-and-custom-kpi", "en", async (page) => {
    await login(page);
    await page.goto("/settings/goals");
    await page.getByRole("heading", { name: "Goals & KPIs", exact: true }).waitFor();
    await page.getByRole("button", { name: "New goal", exact: true }).click();
    const ordinary = page.getByRole("dialog", { name: "New goal", exact: true });
    await ordinary.getByRole("textbox", { name: "Target", exact: true }).waitFor();
    await ordinary.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Custom KPI", exact: true }).click();
    const canvas = page.getByRole("dialog", { name: "KPI editor", exact: true });
    await canvas.getByRole("textbox", { name: "KPI name", exact: true }).fill("CI custom win rate");
    await canvas.getByRole("button", { name: "Add node", exact: true }).click();
    await page.getByRole("button", { name: "Win-rate example", exact: true }).click();
    await canvas.getByRole("banner").getByRole("button", { name: "Preview", exact: true }).click();
    await canvas.getByRole("button", { name: "Save KPI", exact: true }).click();
    await page.getByRole("tab", { name: "KPI library" }).click();
    await page.getByRole("button", { name: "CI custom win rate", exact: true }).waitFor();
    await page.reload();
    await page.getByRole("tab", { name: "KPI library" }).click();
    await page.getByRole("button", { name: "CI custom win rate", exact: true }).waitFor();
  });
  const { runWorkflowDraftSimulationBrowserSmoke } = await import(
    "./workflow-draft-simulation-browser.mjs"
  );
  await runWorkflowDraftSimulationBrowserSmoke({ journey, login, catalog, origin });
} finally {
  await browser.close();
}
