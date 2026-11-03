import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const pipeline = "/pipeline/00000000-0000-4000-8000-000000000503";
const catalog = (path) =>
  JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), "utf8"));
const sales = catalog("src/features/deals/messages/sales.en.json");
const calendar = catalog("src/features/activities/messages/calendar.en.json");
const workflows = catalog("src/features/workflows/messages/workflows.en.json");
const entityCreate = catalog("src/features/entity-create/messages/entityCreate.en.json");
const mail = catalog("src/features/email/connections/messages/mailConnections.en.json");

test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill("browser@example.invalid");
  await page.locator('input[name="password"]').fill("CI-browser-only-password-2026!");
  await page.locator('button[type="submit"]').click();
  await expect(page).not.toHaveURL(/\/login|\/auth\//);
  await expect(page.getByRole("main", { name: "Board CI Pipeline", exact: true })).toBeVisible();
});

test("deal creation persists through a production-page reload", async ({ page }) => {
  await page.goto(pipeline);
  await page.getByRole("button", { name: sales.deal_96653, exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("textbox", { name: sales.deal_title_95b14, exact: true })
    .fill("CI persisted deal");
  await dialog.getByRole("button", { name: entityCreate.save, exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.goto(pipeline);
  await expect(page.getByText("CI persisted deal", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("CI persisted deal", { exact: true })).toBeVisible();
});

test("Calendar creation persists through a production-page reload", async ({ page }) => {
  await page.goto("/activities/calendar");
  await page.getByRole("button", { name: calendar.editor.create, exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("textbox", { name: calendar.editor.eventTitle, exact: true })
    .fill("CI persisted event");
  await dialog.locator('button[type="submit"]').click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await expect(page.getByText("CI persisted event", { exact: true }).first()).toBeVisible();
});

test("mailbox setup opens and closes without creating a connection", async ({ page }) => {
  await page.goto("/settings/email-sync");
  await expect(page.getByText(mail.empty, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: mail.add, exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  // Opening and dismissing setup must not create a provider connection.
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.getByText(mail.empty, { exact: true })).toBeVisible();
});

test("follow-up workflow draft persists through reload", async ({ page }) => {
  await page.goto("/workflows");
  await page.getByRole("button", { name: workflows.new, exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("textbox", { name: workflows.name, exact: true })
    .fill("CI follow-up draft");
  await dialog.getByRole("button", { name: workflows.create, exact: true }).click();
  await expect(page).toHaveURL(/\/workflows\/[0-9a-f-]+$/);
  await page.goto("/workflows");
  await expect(page.getByRole("link", { name: /CI follow-up draft/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("link", { name: /CI follow-up draft/ })).toBeVisible();
});

for (const locale of ["fa", "de"]) {
  test(`login renders its actual ${locale} locale in a mobile browser`, async ({ browser }) => {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 390, height: 844 },
    });
    try {
      await context.addCookies([
        { name: "warpdrive_locale", value: locale, url: "https://127.0.0.1:3443" },
      ]);
      const page = await context.newPage();
      await page.goto("https://127.0.0.1:3443/login");
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page.locator('input[name="email"]')).toBeVisible();
      await expect(page.locator('input[name="password"]')).toBeVisible();
      if (locale === "fa") await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    } finally {
      await context.close();
    }
  });
}
