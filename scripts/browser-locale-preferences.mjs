import assert from "node:assert/strict";

// Keep this helper deliberately small and UI-bound. It is used only after a real native login so
// account locale state is established through the same Language & region control a user sees;
// callers must not replace this with a locale cookie or a direct database write.
const languageLabels = ["Language", "Sprache", "زبان"];
const languageOptions = {
  en: "English",
  de: "Deutsch",
  fa: "فارسی",
};

export async function prepareLocaleThroughUi(page, origin, locale) {
  assert.ok(languageOptions[locale], `Supported browser locale: ${locale}`);
  const response = await page.goto("/settings/regional", { waitUntil: "domcontentloaded" });
  assert.ok(response, "Regional settings returned a response");
  assert.equal(response.status(), 200, "Regional settings status");
  assert.equal(
    new URL(page.url()).origin,
    origin,
    "Regional settings stays on the admitted origin",
  );

  const languageSelector = () =>
    page.locator(
      languageLabels.map((label) => `[role="combobox"][aria-label="${label}"]`).join(","),
    );
  const selectLocale = async (nextLocale) => {
    const language = languageSelector();
    await language.first().waitFor({ state: "visible" });
    await language.first().click();
    await page.getByRole("option", { name: languageOptions[nextLocale], exact: true }).click();
    await page.waitForFunction(
      ({ locale: expectedLocale, direction, cookieName }) => {
        const cookies = document.cookie.split("; ").map((value) => value.split("=", 2));
        return (
          document.documentElement.lang === expectedLocale &&
          document.documentElement.dir === direction &&
          cookies.some(([name, value]) => name === cookieName && value === expectedLocale)
        );
      },
      {
        locale: nextLocale,
        direction: nextLocale === "fa" ? "rtl" : "ltr",
        cookieName: "warpdrive_locale",
      },
    );
  };

  const documentLocale = await page.locator("html").getAttribute("lang");
  const transitions = [];
  // Selecting an alternate first when the requested locale is already rendered makes this
  // helper prove an account write even when the initial page came from a cookie-only hint.
  if (documentLocale === locale) {
    const alternate = locale === "en" ? "de" : "en";
    await selectLocale(alternate);
    transitions.push(alternate);
  }
  await selectLocale(locale);
  transitions.push(locale);
  assert.equal(await page.locator("html").getAttribute("lang"), locale);
  assert.equal(await page.locator("html").getAttribute("dir"), locale === "fa" ? "rtl" : "ltr");
  return { locale, changed: true, transitions, nativeControl: true };
}
