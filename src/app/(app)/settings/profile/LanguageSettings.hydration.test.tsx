// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, screen } from "@testing-library/react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { LocaleProvider, useSetLocalePreferences } from "@/features/i18n/LocaleProvider";
import { LanguageSettings } from "./LanguageSettings";
import { formatRegionalPreview } from "./regionalPreview";

vi.mock("@/features/i18n/actions", () => ({
  saveLocalePreferencesAction: () => Promise.resolve({ ok: true }),
}));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "test-csrf" }));

function PreferenceChange() {
  const choose = useSetLocalePreferences();
  return (
    <button type="button" onClick={() => void choose({ locale: "de", timeZone: "Asia/Tehran" })}>
      Change preferences
    </button>
  );
}

it("hydrates the server preview before displaying browser formatting and live preferences", async () => {
  const preferences = {
    locale: "en",
    country: "DE",
    calendar: "gregory",
    timeZone: "UTC",
  } as const;
  const clientPreview = formatRegionalPreview(preferences);
  const initialPreview = { ...clientPreview, localDate: "21 Mar 2026 [server ICU]" };
  const recoverableErrors: unknown[] = [];
  let root: Root | undefined;
  const container = document.createElement("div");
  document.body.append(container);

  const view = (
    <LocaleProvider {...preferences}>
      <LanguageSettings initialPreview={initialPreview} />
      <PreferenceChange />
    </LocaleProvider>
  );
  const preview = () =>
    Array.from(container.querySelectorAll("dl bdi"), (element) => element.textContent);
  const values = (formatted: typeof clientPreview) => [
    formatted.date,
    formatted.localDate,
    formatted.time,
    formatted.number,
  ];

  try {
    container.innerHTML = renderToString(view);
    expect(preview()).toEqual(values(initialPreview));

    await act(async () => {
      root = hydrateRoot(container, view, {
        onRecoverableError: (error) => recoverableErrors.push(error),
      });
      await Promise.resolve();
    });
    expect(recoverableErrors).toEqual([]);
    expect(preview()).toEqual(values(clientPreview));

    await act(() =>
      Promise.resolve(screen.getByRole("button", { name: "Change preferences" }).click()),
    );
    const updated = formatRegionalPreview({
      ...preferences,
      locale: "de",
      timeZone: "Asia/Tehran",
    });
    expect(updated.time).not.toBe(clientPreview.time);
    expect(preview()).toEqual(values(updated));
    expect(document.documentElement).toHaveAttribute("lang", "de");
  } finally {
    await act(() => Promise.resolve(root?.unmount()));
    container.remove();
    document.documentElement.removeAttribute("lang");
    document.documentElement.removeAttribute("dir");
  }
});
