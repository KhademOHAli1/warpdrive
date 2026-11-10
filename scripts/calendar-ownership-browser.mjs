import assert from "node:assert/strict";

// Native UI, real server actions and the existing isolated browser database only.
// The caller retains network blocking and native password/session setup.
export async function runCalendarOwnershipBrowserSmoke({ journey, login, catalog }) {
  for (const [index, locale] of ["en", "de", "fa"].entries()) {
    const copy = catalog(`src/features/activities/messages/calendar.${locale}.json`);
    await journey(`calendar-ownership-${locale}`, locale, async (page) => {
      await login(page);
      await page.goto(
        `/activities/calendar?view=day&d=2032-06-${String(17 + index).padStart(2, "0")}`,
      );
      await page.getByRole("button", { name: copy.settings.manage, exact: true }).click();
      await page.getByRole("dialog", { name: copy.settings.manage, exact: true }).waitFor();
      await page.getByRole("button", { name: copy.settings.personal, exact: true }).waitFor();
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      await page.getByRole("button", { name: copy.editor.create, exact: true }).click();
      let dialog = page.getByRole("dialog");
      const title = `CI Calendar ownership ${locale} / تقویم Ä`;
      await dialog.getByRole("textbox", { name: copy.editor.eventTitle, exact: true }).fill(title);
      const advanced = () =>
        dialog.getByRole("button", { name: copy.settings.eventCalendar, exact: true });
      await advanced().click();
      await dialog.getByRole("combobox", { name: copy.settings.visibility, exact: true }).click();
      await page.getByRole("option", { name: copy.settings.private, exact: true }).click();
      await dialog.getByRole("button", { name: copy.reminders.title, exact: true }).click();
      const defaults = () =>
        dialog.getByRole("checkbox", { name: copy.reminders.useDefault, exact: true });
      await defaults().uncheck();
      const remove = dialog.getByRole("button", {
        name: copy.reminders.remove.replace("{index, number}", locale === "fa" ? "۱" : "1"),
        exact: true,
      });
      await remove.click();
      await advanced().click();
      await advanced().click();
      assert.equal(
        await defaults().isChecked(),
        false,
        "Collapsed personal policy remains explicit",
      );
      assert.equal(
        (
          await dialog
            .getByRole("combobox", { name: copy.settings.visibility, exact: true })
            .textContent()
        )?.trim(),
        copy.settings.private,
      );
      await dialog.locator('button[type="submit"]').click();
      await dialog.waitFor({ state: "hidden" });
      await page.reload();
      await page.getByText(title, { exact: true }).first().click();
      dialog = page.getByRole("dialog");
      await advanced().click();
      assert.equal(
        (
          await dialog
            .getByRole("combobox", { name: copy.settings.visibility, exact: true })
            .textContent()
        )?.trim(),
        copy.settings.private,
        "Private event setting persisted",
      );
      await dialog.getByRole("button", { name: copy.reminders.title, exact: true }).click();
      assert.equal(
        await defaults().isChecked(),
        false,
        "Personal policy persisted separately from native generations",
      );
      await dialog.getByRole("combobox", { name: copy.settings.availability, exact: true }).click();
      await page.getByRole("option", { name: copy.settings.free, exact: true }).click();
      await advanced().click();
      await advanced().click();
      await dialog.locator('button[type="submit"]').click();
      await dialog.waitFor({ state: "hidden" });
      await page.reload();
      await page.getByText(title, { exact: true }).first().click();
      dialog = page.getByRole("dialog");
      await advanced().click();
      assert.equal(
        (
          await dialog
            .getByRole("combobox", { name: copy.settings.availability, exact: true })
            .textContent()
        )?.trim(),
        copy.settings.free,
        "Advanced-only edit persisted through the versioned native action",
      );
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
    });
  }
}
