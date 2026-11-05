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

function languageControl(label) {
  return `[role="combobox"][aria-label="${label}"]`;
}

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

async function selectLanguage(page, locale) {
  const language = page
    .locator(Object.values(languageLabels).map(languageControl).join(","))
    .first();
  const expanded = language.and(page.locator('[aria-expanded="true"]'));
  const listbox = page.getByRole("listbox");
  const option = listbox.getByRole("option", { name: languageOptions[locale], exact: true });
  // A pre-hydration click may focus the SSR trigger without opening it.
  // Require an expanded trigger, not just an option in a closing portal.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      if ((await language.getAttribute("aria-expanded")) !== "true") {
        await listbox.waitFor({ state: "hidden", timeout: 1500 });
        await language.click({ timeout: 1500 });
      }
      await expanded.waitFor({ state: "visible", timeout: 1500 });
      await option.click({ timeout: 1500 });
      return;
    } catch (error) {
      if (!(error instanceof Error) || error.name !== "TimeoutError" || attempt === 2) throw error;
    }
  }
}

async function waitForReadyLocale(page, locale, changed) {
  // Document direction is optimistic. A changed locale must also have its
  // cookie and an enabled, closed control after the app consumes the response.
  await page.waitForFunction(
    ({ expectedLocale, direction, selector, selectedLanguage, changedLocale }) => {
      const cookies = document.cookie.split("; ").map((value) => value.split("=", 2));
      const control = document.querySelector(selector);
      return (
        document.documentElement.lang === expectedLocale &&
        document.documentElement.dir === direction &&
        (!changedLocale ||
          cookies.some(
            ([name, value]) => name === "warpdrive_locale" && value === expectedLocale,
          )) &&
        control !== null &&
        control.getAttribute("aria-expanded") === "false" &&
        !control.matches(':disabled, [aria-disabled="true"]') &&
        control.textContent?.trim() === selectedLanguage
      );
    },
    {
      expectedLocale: locale,
      direction: locale === "fa" ? "rtl" : "ltr",
      selector: languageControl(languageLabels[locale]),
      selectedLanguage: languageOptions[locale],
      changedLocale: changed,
    },
  );
}

export async function prepareLocaleThroughUi(page, origin, locale) {
  assert.ok(languageOptions[locale], `Supported browser locale: ${locale}`);
  const response = await page.goto("/settings/regional", { waitUntil: "load" });
  assert.equal(response?.status(), 200, "Regional settings status");
  assert.equal(page.url(), `${origin}/settings/regional`, "Authenticated regional settings URL");
  const changed = (await page.locator("html").getAttribute("lang")) !== locale;
  if (changed) await selectLanguage(page, locale);
  await waitForReadyLocale(page, locale, changed);
  return { locale, changed, transitions: changed ? [locale] : [], nativeControl: true };
}
