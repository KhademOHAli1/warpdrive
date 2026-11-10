import assert from "node:assert/strict";

export const agencyBrowserClient = {
  id: "00000000-0000-4000-8000-0000000005a1",
  name: "CI Agency Client / استودیو Ä",
};

// Called only after the existing disposable browser environment has been admitted.
export async function seedAgencyBrowserFixture(client, password, flagKeys) {
  const permissionId = "00000000-0000-4000-8000-0000000005a5";
  await client.query(
    "INSERT INTO permission_sets(id,name,flags) VALUES($1,'CI agency permissions',$2)",
    [
      permissionId,
      JSON.stringify(Object.fromEntries(flagKeys.map((key) => [key, key === "project.create"]))),
    ],
  );
  for (const [index, locale] of ["en", "de", "fa"].entries()) {
    const id = `00000000-0000-4000-8000-0000000005a${index + 2}`;
    const email = `agency-${locale}@example.invalid`;
    const name = `CI Agency ${locale}`;
    await client.query(
      "INSERT INTO users(id,email,name,is_admin,permission_set_id) VALUES($1,$2,$3,false,$4)",
      [id, email, name, permissionId],
    );
    await client.query(
      "INSERT INTO auth_users(id,email,name,email_verified) VALUES($1,$2,$3,true)",
      [id, email, name],
    );
    await client.query(
      "INSERT INTO auth_accounts(user_id,account_id,provider_id,password) VALUES($1,$2,'credential',$3)",
      [id, id, password],
    );
    const timeZone = locale === "fa" ? "Asia/Tehran" : locale === "de" ? "Europe/Berlin" : "UTC";
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
  await client.query(
    "INSERT INTO organizations(id,name,owner_id,visibility_level) VALUES($1,$2,$3,'all')",
    [agencyBrowserClient.id, agencyBrowserClient.name, "00000000-0000-4000-8000-0000000005a2"],
  );
  await client.query(
    "INSERT INTO agency_project_settings(id,enabled) VALUES(true,true) ON CONFLICT(id) DO UPDATE SET enabled=true",
  );
}

export async function runAgencyProjectsBrowserSmoke({ journey, signIn, catalog }) {
  for (const locale of ["en", "de", "fa"]) {
    const copy = catalog(`src/features/agency-projects/messages/agencyProjects.${locale}.json`);
    await journey(`agency-projects-${locale}`, locale, async (page) => {
      await signIn(page, `agency-${locale}@example.invalid`);
      await page.goto("/projects");
      await page.getByRole("heading", { name: copy.screen.title, exact: true }).first().waitFor();
      await page.getByRole("button", { name: copy.screen.client, exact: true }).click();
      await page.getByRole("option", { name: agencyBrowserClient.name, exact: true }).click();
      const title = `CI Agency ${locale} / پروژه Ä`;
      await page.getByRole("textbox", { name: copy.projectName, exact: true }).fill(title);
      await page.getByRole("button", { name: copy.createProject, exact: true }).click();
      await page.getByRole("heading", { name: copy.workspaceHeading, exact: true }).waitFor();
      await page.getByRole("button", { name: copy.startWork, exact: true }).click();
      await page.getByText(copy.startConfirmed, { exact: true }).waitFor();
      await page.getByRole("button", { name: copy.refreshProject, exact: true }).click();
      await page.getByRole("definition").filter({ hasText: copy.stateActive }).waitFor();
      await page.getByRole("button", { name: copy.screen.back, exact: true }).click();
      await page.getByRole("button", { name: title, exact: true }).waitFor();
      await page.reload();
      await page.getByRole("button", { name: title, exact: true }).click();
      await page.getByRole("definition").filter({ hasText: copy.stateActive }).waitFor();
      assert.equal(
        await page.getByRole("button", { name: copy.startWork, exact: true }).count(),
        0,
      );
    });
  }
}
