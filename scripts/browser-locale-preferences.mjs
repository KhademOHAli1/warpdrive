import assert from "node:assert/strict";

// Keep this helper deliberately small and UI-bound. It is used only after a real native login so
// account locale state is established through the same Language & region control a user sees;
// callers must not replace this with a locale cookie or a direct database write.
const languageLabels = { en: "Language", de: "Sprache", fa: "زبان" };
const languageOptions = {
  en: "English",
  de: "Deutsch",
  fa: "فارسی",
};

export function isRegionalSaveRequest(request, origin) {
  const url = new URL(request.url());
  return (
    url.origin === origin &&
    ["/login", "/settings/regional"].includes(url.pathname) &&
    request.method() === "POST" &&
    Boolean(request.headers()["next-action"])
  );
}

// Some successful Next action streams are cancelled on the browser side after
// applying the result. Capture the full, unmodified response from the real server
// so only that exact delivered request can be distinguished from a failed POST.
export async function deliverRegionalSave(route) {
  const response = await route.fetch({ maxRedirects: 0, maxRetries: 0 });
  try {
    const saved =
      response.status() === 200 &&
      response.headers()["content-type"]?.startsWith("text/x-component") &&
      response
        .headersArray()
        .some(
          ({ name, value }) =>
            name.toLowerCase() === "set-cookie" && /^warpdrive_locale=(?:en|de|fa);/.test(value),
        ) &&
      (await response.body()).byteLength > 0;
    await route.fulfill({ response });
    return saved === true;
  } finally {
    await response.dispose();
  }
}

export async function prepareLocaleThroughUi(page, origin, locale) {
  assert.ok(languageOptions[locale], `Supported browser locale: ${locale}`);
  const response = await page.goto("/settings/regional", { waitUntil: "load" });
  assert.ok(response, "Regional settings returned a response");
  assert.equal(response.status(), 200, "Regional settings status");
  assert.equal(
    new URL(page.url()).origin,
    origin,
    "Regional settings stays on the admitted origin",
  );

  const languageSelector = () =>
    page.locator(
      Object.values(languageLabels)
        .map((label) => `[role="combobox"][aria-label="${label}"]`)
        .join(","),
    );
  const selectLocale = async (nextLocale) => {
    const language = languageSelector().first();
    const option = page.getByRole("option", { name: languageOptions[nextLocale], exact: true });
    // An SSR trigger is visible before the picker can open. Require the real
    // option and allow a bounded retry if the first click preceded hydration.
    for (let attempt = 0; attempt < 3 && !(await option.isVisible()); attempt += 1) {
      if ((await language.getAttribute("aria-expanded")) !== "true") await language.click();
      try {
        await option.waitFor({ state: "visible", timeout: 1500 });
      } catch (error) {
        if (!(error instanceof Error) || error.name !== "TimeoutError" || attempt === 2)
          throw error;
      }
    }
    await option.click();
    // The new document direction is optimistic, and the cookie can arrive with
    // headers. The localized control only becomes enabled again after the app
    // consumes the action response and clears its pending state.
    await page.waitForFunction(
      ({ locale: expectedLocale, direction, cookieName, controlLabel, selectedLanguage }) => {
        const cookies = document.cookie.split("; ").map((value) => value.split("=", 2));
        const control = document.querySelector(`[role="combobox"][aria-label="${controlLabel}"]`);
        return (
          document.documentElement.lang === expectedLocale &&
          document.documentElement.dir === direction &&
          cookies.some(([name, value]) => name === cookieName && value === expectedLocale) &&
          control !== null &&
          !control.matches(':disabled, [aria-disabled="true"]') &&
          control.textContent?.trim() === selectedLanguage
        );
      },
      {
        locale: nextLocale,
        direction: nextLocale === "fa" ? "rtl" : "ltr",
        cookieName: "warpdrive_locale",
        controlLabel: languageLabels[nextLocale],
        selectedLanguage: languageOptions[nextLocale],
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
