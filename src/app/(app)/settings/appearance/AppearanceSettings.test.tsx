// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { Locale } from "@/features/i18n/registry";
import { APPEARANCE_COOKIE, DARK_CLASS } from "@/features/theme/appearance";
import { AppearanceSettings } from "./AppearanceSettings";

type SaveResult = { ok: true } | { ok: false; error: { id: string } };
const { saveDensity, saveTheme, report, refresh } = vi.hoisted(() => ({
  saveDensity: vi.fn<() => Promise<SaveResult>>(),
  saveTheme: vi.fn<() => Promise<SaveResult>>(),
  report: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/features/identity/preferencesActions", () => ({
  setDensityAction: saveDensity,
  setAppearanceAction: saveTheme,
}));
vi.mock("@/features/i18n/actions", () => ({ saveLocalePreferencesAction: vi.fn() }));
vi.mock("@/components/shell/ActionErrorProvider", () => ({ useActionError: () => report }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));

beforeEach(() => {
  saveDensity.mockReset().mockResolvedValue({ ok: true });
  saveTheme.mockReset().mockResolvedValue({ ok: true });
  report.mockClear();
  refresh.mockReset();
  document.documentElement.className = "";
  document.documentElement.dataset.density = "comfortable";
  document.cookie = `${APPEARANCE_COOKIE}=; max-age=0; path=/`;
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.density;
  document.documentElement.removeAttribute("dir");
  document.documentElement.removeAttribute("lang");
});

function deferred() {
  let settle!: (result: SaveResult) => void;
  const promise = new Promise<SaveResult>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

function show(locale: Locale = "en") {
  return render(
    <LocaleProvider locale={locale}>
      <AppearanceSettings density="comfortable" appearance="day" />
    </LocaleProvider>,
  );
}

async function pickTheme(name: string, label = "Theme") {
  await userEvent.click(screen.getByRole("combobox", { name: label }));
  await userEvent.click(screen.getByRole("option", { name }));
}

async function settle(save: ReturnType<typeof deferred>, result: SaveResult) {
  await act(async () => {
    save.settle(result);
    await save.promise;
  });
}

describe("explicit density save", () => {
  it("keeps a density choice as a draft until Save and ignores unchanged values", () => {
    show();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: "Compact" }));
    expect(saveDensity).not.toHaveBeenCalled();
    expect(document.documentElement.dataset.density).toBe("comfortable");
    expect(screen.getByRole("status", { name: "Interface density" })).toBeEmptyDOMElement();
    fireEvent.click(screen.getByRole("radio", { name: "Comfortable" }));
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(saveDensity).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("announces saving before success, guards duplicate submissions and refreshes only on success", async () => {
    const pending = deferred();
    saveDensity.mockReturnValueOnce(pending.promise);
    show();
    const status = screen.getByRole("status", { name: "Interface density" });
    fireEvent.click(screen.getByRole("radio", { name: "Compact" }));
    const button = screen.getByRole("button", { name: "Save" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(status).toHaveTextContent("Saving interface density…");
    expect(status).not.toHaveTextContent("Interface density saved.");
    expect(button).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Comfortable" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Compact" })).toBeDisabled();
    expect(saveDensity).toHaveBeenCalledTimes(1);
    expect(saveDensity).toHaveBeenCalledWith({ density: "compact" }, "csrf");
    expect(refresh).not.toHaveBeenCalled();

    await settle(pending, { ok: true });
    expect(screen.getByRole("status", { name: "Interface density" })).toBe(status);
    expect(status).toHaveTextContent("Interface density saved.");
    expect(button).toBeDisabled();
    expect(refresh).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("radio", { name: "Comfortable" }));
    expect(status).toBeEmptyDOMElement();
    expect(button).toBeEnabled();
    expect(saveDensity).toHaveBeenCalledTimes(1);
  });

  it("keeps density success without reporting a save failure when refresh throws", async () => {
    refresh.mockImplementationOnce(() => {
      throw new Error("navigation interrupted");
    });
    show();
    fireEvent.click(screen.getByRole("radio", { name: "Compact" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(screen.getByRole("status", { name: "Interface density" })).toHaveTextContent(
        "Interface density saved.",
      ),
    );
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(report).not.toHaveBeenCalled();
    expect(screen.getByRole("alert", { name: "Interface density" })).toBeEmptyDOMElement();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Retry density save" })).not.toBeInTheDocument();
    expect(saveDensity).toHaveBeenCalledTimes(1);
  });

  it("retains a denied draft and retries the exact density without a stale timezone", async () => {
    saveDensity.mockResolvedValueOnce({ ok: false, error: { id: "E_AUTH_CSRF" } });
    show();
    fireEvent.click(screen.getByRole("radio", { name: "Compact" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(report).toHaveBeenCalledWith("E_AUTH_CSRF"));
    expect(screen.getByRole("alert", { name: "Interface density" })).toHaveTextContent(
      "Could not save interface density. Your selection is kept. Try again.",
    );
    expect(screen.getByRole("radio", { name: "Compact" })).toBeChecked();
    expect(refresh).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Retry density save" }));
    await waitFor(() =>
      expect(screen.getByRole("status", { name: "Interface density" })).toHaveTextContent(
        "Interface density saved.",
      ),
    );
    expect(saveDensity).toHaveBeenCalledTimes(2);
    expect(saveDensity).toHaveBeenNthCalledWith(2, { density: "compact" }, "csrf");
    expect(screen.getByRole("alert", { name: "Interface density" })).toBeEmptyDOMElement();
  });

  it("shows a thrown failure locally and clears obsolete recovery when the draft changes", async () => {
    saveDensity.mockRejectedValueOnce(new Error("private connection details"));
    show();
    fireEvent.click(screen.getByRole("radio", { name: "Compact" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(report).toHaveBeenCalledWith());
    expect(screen.getByRole("alert", { name: "Interface density" })).toHaveTextContent(
      "Your selection is kept.",
    );
    expect(screen.queryByText("private connection details")).not.toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("radio", { name: "Comfortable" }));
    expect(screen.getByRole("alert", { name: "Interface density" })).toBeEmptyDOMElement();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Retry density save" })).not.toBeInTheDocument();
  });
});

describe("theme autosave", () => {
  it("paints immediately, announces saving and waits for the latest acknowledgement before success", async () => {
    const pending = deferred();
    saveTheme.mockReturnValueOnce(pending.promise);
    show();
    const status = screen.getByRole("status", { name: "Theme" });
    await pickTheme("Dark");
    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(true);
    expect(document.cookie).toContain(`${APPEARANCE_COOKIE}=night`);
    expect(status).toHaveTextContent("Saving theme…");
    expect(screen.getByRole("combobox", { name: "Theme" })).toBeEnabled();
    expect(saveTheme).toHaveBeenCalledWith({ appearance: "night" }, "csrf");
    expect(screen.getByRole("status", { name: "Interface density" })).toBeEmptyDOMElement();
    expect(saveDensity).not.toHaveBeenCalled();
    await settle(pending, { ok: true });
    expect(screen.getByRole("status", { name: "Theme" })).toBe(status);
    expect(status).toHaveTextContent("Theme saved.");
    expect(refresh).not.toHaveBeenCalled();
  });

  it.each(["returned", "thrown"] as const)(
    "shows a %s failure, rolls back and retries the attempted theme",
    async (failure) => {
      if (failure === "returned") {
        saveTheme.mockResolvedValueOnce({ ok: false, error: { id: "E_DB_001" } });
      } else {
        saveTheme.mockRejectedValueOnce(new Error("private database address"));
      }
      show();
      await pickTheme("Dark");
      await waitFor(() =>
        expect(screen.getByRole("alert", { name: "Theme" })).toHaveTextContent(
          "Could not save the theme. The previous theme is shown. Try again.",
        ),
      );
      expect(report).toHaveBeenCalledWith(failure === "returned" ? "E_DB_001" : "E_DB_003");
      expect(screen.getByRole("combobox", { name: "Theme" })).toHaveTextContent("Light");
      expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(false);
      expect(document.cookie).toContain(`${APPEARANCE_COOKIE}=day`);
      expect(screen.queryByText("private database address")).not.toBeInTheDocument();
      const retry = deferred();
      saveTheme.mockReturnValueOnce(retry.promise);
      fireEvent.click(screen.getByRole("button", { name: "Retry theme save" }));
      expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(true);
      expect(screen.getByRole("status", { name: "Theme" })).toHaveTextContent("Saving theme…");
      expect(screen.getByRole("alert", { name: "Theme" })).toBeEmptyDOMElement();
      await waitFor(() => expect(saveTheme).toHaveBeenCalledTimes(2));
      expect(saveTheme).toHaveBeenLastCalledWith({ appearance: "night" }, "csrf");
      await settle(retry, { ok: true });
      expect(screen.getByRole("status", { name: "Theme" })).toHaveTextContent("Theme saved.");
    },
  );

  it("returns keyboard focus to the theme control before Retry becomes pending", async () => {
    saveTheme.mockResolvedValueOnce({ ok: false, error: { id: "E_DB_001" } });
    show();
    await pickTheme("Dark");
    const retry = await screen.findByRole("button", { name: "Retry theme save" });
    const control = screen.getByRole("combobox", { name: "Theme" });
    control.focus();
    await userEvent.tab();
    expect(retry).toHaveFocus();
    const pending = deferred();
    saveTheme.mockReturnValueOnce(pending.promise);
    await userEvent.keyboard("{Enter}");
    expect(screen.queryByRole("button", { name: "Retry theme save" })).not.toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Theme" })).toHaveTextContent("Saving theme…");
    expect(control).toHaveFocus();
    await settle(pending, { ok: true });
    expect(screen.getByRole("status", { name: "Theme" })).toHaveTextContent("Theme saved.");
    expect(control).toHaveFocus();
  });

  it.each([true, false])(
    "keeps the latest pending feedback when an older save settles with ok=%s",
    async (ok) => {
      const first = deferred();
      const second = deferred();
      saveTheme.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
      show();
      await pickTheme("Dark");
      await pickTheme("System");
      expect(saveTheme).toHaveBeenCalledTimes(1);
      await settle(first, ok ? { ok: true } : { ok: false, error: { id: "E_DB_001" } });
      await waitFor(() => expect(saveTheme).toHaveBeenCalledTimes(2));
      expect(saveTheme).toHaveBeenNthCalledWith(2, { appearance: "system" }, "csrf");
      expect(screen.getByRole("status", { name: "Theme" })).toHaveTextContent("Saving theme…");
      expect(screen.getByRole("alert", { name: "Theme" })).toBeEmptyDOMElement();
      expect(report).not.toHaveBeenCalled();
      await settle(second, { ok: true });
      expect(screen.getByRole("status", { name: "Theme" })).toHaveTextContent("Theme saved.");
      expect(screen.getByRole("combobox", { name: "Theme" })).toHaveTextContent("System");
    },
  );

  it("keeps density recovery while theme autosave succeeds", async () => {
    saveDensity.mockResolvedValueOnce({ ok: false, error: { id: "E_AUTH_CSRF" } });
    show();
    fireEvent.click(screen.getByRole("radio", { name: "Compact" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(screen.getByRole("alert", { name: "Interface density" })).toHaveTextContent(
        "Your selection is kept.",
      ),
    );
    await pickTheme("Dark");
    await waitFor(() =>
      expect(screen.getByRole("status", { name: "Theme" })).toHaveTextContent("Theme saved."),
    );
    expect(screen.getByRole("alert", { name: "Interface density" })).toHaveTextContent(
      "Your selection is kept.",
    );
    expect(screen.getByRole("radio", { name: "Compact" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Retry density save" })).toBeEnabled();
    expect(saveDensity).toHaveBeenCalledTimes(1);
  });
});

const localizedCases = [
  {
    locale: "en",
    theme: "Theme",
    dark: "Dark",
    density: "Interface density",
    compact: "Compact",
    save: "Save",
    themeSaving: "Saving theme…",
    themeSaved: "Theme saved.",
    themeError: "Could not save the theme. The previous theme is shown. Try again.",
    themeRetry: "Retry theme save",
    densitySaving: "Saving interface density…",
    densitySaved: "Interface density saved.",
    densityError: "Could not save interface density. Your selection is kept. Try again.",
    densityRetry: "Retry density save",
  },
  {
    locale: "de",
    theme: "Design",
    dark: "Dunkel",
    density: "Anzeigedichte",
    compact: "Kompakt",
    save: "Speichern",
    themeSaving: "Design wird gespeichert…",
    themeSaved: "Design gespeichert.",
    themeError:
      "Das Design konnte nicht gespeichert werden. Das vorherige Design wird angezeigt. Versuchen Sie es erneut.",
    themeRetry: "Design erneut speichern",
    densitySaving: "Anzeigedichte wird gespeichert…",
    densitySaved: "Anzeigedichte gespeichert.",
    densityError:
      "Die Anzeigedichte konnte nicht gespeichert werden. Ihre Auswahl bleibt erhalten. Versuchen Sie es erneut.",
    densityRetry: "Dichte erneut speichern",
  },
  {
    locale: "fa",
    theme: "رنگ‌بندی",
    dark: "تیره",
    density: "تراکم نمایش",
    compact: "فشرده",
    save: "ذخیره",
    themeSaving: "در حال ذخیرهٔ رنگ‌بندی…",
    themeSaved: "رنگ‌بندی ذخیره شد.",
    themeError: "رنگ‌بندی ذخیره نشد. رنگ‌بندی قبلی نمایش داده می‌شود. دوباره تلاش کنید.",
    themeRetry: "ذخیرهٔ دوبارهٔ رنگ‌بندی",
    densitySaving: "در حال ذخیرهٔ تراکم نمایش…",
    densitySaved: "تراکم نمایش ذخیره شد.",
    densityError: "تراکم نمایش ذخیره نشد. انتخاب شما حفظ شده است. دوباره تلاش کنید.",
    densityRetry: "ذخیرهٔ دوبارهٔ تراکم",
  },
] as const;

// DOM semantics/localization witnesses only: these are not native browser or screen-reader acceptance.
it.each(localizedCases)("localizes saving, failure, retry and success in $locale", async (copy) => {
  const theme = deferred();
  const density = deferred();
  saveTheme.mockReturnValueOnce(theme.promise);
  saveDensity.mockReturnValueOnce(density.promise);
  show(copy.locale);
  expect(document.documentElement.dir).toBe(copy.locale === "fa" ? "rtl" : "ltr");
  await pickTheme(copy.dark, copy.theme);
  fireEvent.click(screen.getByRole("radio", { name: copy.compact }));
  fireEvent.click(screen.getByRole("button", { name: copy.save }));
  expect(screen.getByRole("status", { name: copy.theme })).toHaveTextContent(copy.themeSaving);
  expect(screen.getByRole("status", { name: copy.density })).toHaveTextContent(copy.densitySaving);
  await settle(theme, { ok: false, error: { id: "E_DB_001" } });
  await settle(density, { ok: false, error: { id: "E_DB_001" } });
  expect(screen.getByRole("alert", { name: copy.theme })).toHaveTextContent(copy.themeError);
  expect(screen.getByRole("alert", { name: copy.density })).toHaveTextContent(copy.densityError);
  fireEvent.click(screen.getByRole("button", { name: copy.themeRetry }));
  fireEvent.click(screen.getByRole("button", { name: copy.densityRetry }));
  await waitFor(() =>
    expect(screen.getByRole("status", { name: copy.theme })).toHaveTextContent(copy.themeSaved),
  );
  expect(screen.getByRole("status", { name: copy.density })).toHaveTextContent(copy.densitySaved);
  expect(screen.getByRole("alert", { name: copy.theme })).toBeEmptyDOMElement();
  expect(screen.getByRole("alert", { name: copy.density })).toBeEmptyDOMElement();
  expect(saveTheme).toHaveBeenCalledTimes(2);
  expect(saveDensity).toHaveBeenCalledTimes(2);
});
