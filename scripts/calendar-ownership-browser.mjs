import assert from "node:assert/strict";

// Called only after browser-smoke-seed has admitted its disposable environment.
export async function seedCalendarOwnershipBrowserFixture(client, password, flagKeys, groupId) {
  const permissionId = "00000000-0000-4000-8000-0000000005c4";
  await client.query(
    "INSERT INTO permission_sets(id,name,flags) VALUES($1,'CI calendar permissions',$2)",
    [
      permissionId,
      JSON.stringify(Object.fromEntries(flagKeys.map((key) => [key, key === "activity.create"]))),
    ],
  );
  for (const [index, locale] of ["en", "de", "fa"].entries()) {
    const id = `00000000-0000-4000-8000-0000000005c${index + 1}`;
    const email = `calendar-${locale}@example.invalid`;
    const name = `CI Calendar ${locale}`;
    const timeZone = locale === "fa" ? "Asia/Tehran" : locale === "de" ? "Europe/Berlin" : "UTC";
    await client.query(
      "INSERT INTO users(id,email,name,is_admin,permission_set_id,primary_visibility_group_id) VALUES($1,$2,$3,false,$4,$5)",
      [id, email, name, permissionId, groupId],
    );
    await client.query("INSERT INTO visibility_group_members(group_id,user_id) VALUES($1,$2)", [
      groupId,
      id,
    ]);
    await client.query(
      "INSERT INTO auth_users(id,email,name,email_verified) VALUES($1,$2,$3,true)",
      [id, email, name],
    );
    await client.query(
      "INSERT INTO auth_accounts(user_id,account_id,provider_id,password) VALUES($1,$2,'credential',$3)",
      [id, id, password],
    );
    await client.query(
      "INSERT INTO user_preferences(user_id,timezone,density,ui) VALUES($1,$2,'comfortable',$3)",
      [
        id,
        timeZone,
        JSON.stringify({
          localePreferences: {
            locale,
            calendar: locale === "fa" ? "persian" : "gregory",
            timeZone,
            country: locale === "fa" ? "IR" : locale === "de" ? "DE" : "US",
            numberingSystem: locale === "fa" ? "arabext" : "latn",
            timeZoneMode: "manual",
          },
        }),
      ],
    );
  }
}

// Native UI, real server actions and the existing isolated browser database only.
// The caller retains network blocking and native password/session setup.
export async function runCalendarOwnershipBrowserSmoke({ journey, login, catalog }) {
  for (const [index, locale] of ["en", "de", "fa"].entries()) {
    const copy = catalog(`src/features/activities/messages/calendar.${locale}.json`);
    await journey(`calendar-ownership-${locale}`, locale, async (page) => {
      await login(page, `calendar-${locale}@example.invalid`);
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
