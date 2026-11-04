import assert from "node:assert/strict";
import { chromium } from "../tools/browser-smoke/node_modules/playwright/index.mjs";

// Intentionally public/unauthenticated coverage: no credentials, provider requests or sends.
const origin = "https://127.0.0.1:3443";
const browser = await chromium.launch({ headless: true });
try {
  for (const [locale, heading, language] of [
    ["en", "Sign in to Warpdrive", "Language"],
    ["de", "Bei Warpdrive anmelden", "Sprache"],
    ["fa", "ورود به Warpdrive", "زبان"],
  ]) {
    const context = await browser.newContext({ ignoreHTTPSErrors: true, serviceWorkers: "block" });
    const errors = [];
    const unexpectedRequests = [];
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.origin === origin) return route.continue();
      unexpectedRequests.push(url.origin);
      return route.abort("blockedbyclient");
    });
    // routeWebSocket does not contact a server unless connectToServer() is called. This public
    // smoke needs no sockets; close every attempt locally and fail the unexpected-request check.
    await context.routeWebSocket("**/*", (socket) => {
      unexpectedRequests.push(new URL(socket.url()).origin);
      return socket.close({ code: 1008, reason: "No WebSockets in public browser smoke" });
    });
    await context.addCookies([{ name: "warpdrive_locale", value: locale, url: origin }]);
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    const response = await page.goto(`${origin}/login`, { waitUntil: "networkidle" });
    assert.equal(response?.status(), 200);
    await page.getByRole("heading", { name: heading, exact: true }).waitFor();
    assert.equal(await page.locator("html").getAttribute("lang"), locale);
    assert.equal(await page.locator("html").getAttribute("dir"), locale === "fa" ? "rtl" : "ltr");
    const email = page.locator('input[name="email"]');
    await email.waitFor(); // Only appears after the real providers API and React hydration succeed.
    await email.fill("browser-smoke@example.invalid");
    assert.equal(await email.inputValue(), "browser-smoke@example.invalid");
    // A real client event opens the Radix menu; SSR text alone cannot satisfy this.
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
    assert.deepEqual(errors, [], `${locale}: browser errors`);
    assert.deepEqual(unexpectedRequests, [], `${locale}: unexpected external requests`);
    console.log(
      `${locale}: translated login, hydrated controls and three protected redirects passed`,
    );
    await context.close();
  }
} finally {
  await browser.close();
}
