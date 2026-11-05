// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocaleProvider, useLocalePreferences, useSetLocalePreferences } from "./LocaleProvider";

const save = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({ saveLocalePreferencesAction: save }));
const actualResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;

function CurrentContext() {
  const preferences = useLocalePreferences();
  const choose = useSetLocalePreferences();
  return (
    <>
      <p data-testid="context">
        {preferences.locale}/{preferences.timeZone}/{preferences.country ?? "-"}/
        {preferences.timeZoneMode ?? "-"}
      </p>
      <button
        type="button"
        onClick={() => void choose({ timeZone: "UTC", timeZoneMode: "manual" })}
      >
        Use manual UTC
      </button>
    </>
  );
}

let deviceZone = "Asia/Tehran";
beforeEach(() => {
  deviceZone = "Asia/Tehran";
  const resolved = Intl.DateTimeFormat().resolvedOptions();
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockImplementation(() => ({
    ...resolved,
    timeZone: deviceZone,
  }));
  vi.spyOn(navigator, "languages", "get").mockReturnValue(["fa-IR", "en-US"]);
  save.mockResolvedValue({ ok: true });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  save.mockReset();
});

it("keeps SSR deterministic, then detects Tehran and a country without translating the account", async () => {
  const content = (
    <LocaleProvider locale="en" detectBrowserContext>
      <CurrentContext />
    </LocaleProvider>
  );
  expect(renderToString(content)).toContain("UTC");
  expect(save).not.toHaveBeenCalled();
  render(content);
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      {
        locale: "en",
        calendar: "gregory",
        timeZone: "Asia/Tehran",
        timeZoneMode: "browser",
        country: "IR",
        numberingSystem: "latn",
      },
      null,
    ),
  );
  expect(screen.getByTestId("context")).toHaveTextContent("en/Asia/Tehran/IR/browser");
});

it("does not infer context for isolated providers without the production opt-in", () => {
  render(
    <LocaleProvider>
      <CurrentContext />
    </LocaleProvider>,
  );
  expect(screen.getByTestId("context")).toHaveTextContent("en/UTC/-/-");
  expect(save).not.toHaveBeenCalled();
});

it("preselects browser language and regional formats only for fresh-account hints", async () => {
  render(
    <LocaleProvider detectBrowserContext inferBrowserLanguage inferBrowserFormats>
      <CurrentContext />
    </LocaleProvider>,
  );
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      {
        locale: "fa",
        calendar: "persian",
        numberingSystem: "arabext",
        timeZone: "Asia/Tehran",
        timeZoneMode: "browser",
        country: "IR",
      },
      null,
    ),
  );
});

it("does not loop after a fresh-account defaults save fails", async () => {
  save.mockResolvedValue({ ok: false, error: "save_failed" });
  render(
    <LocaleProvider detectBrowserContext inferBrowserLanguage inferBrowserFormats>
      <CurrentContext />
    </LocaleProvider>,
  );
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  fireEvent.focus(window);
  expect(save).toHaveBeenCalledTimes(1);
});

it("preserves explicit manual UTC and a legacy non-UTC override", () => {
  const first = render(
    <LocaleProvider timeZone="UTC" timeZoneMode="manual" country="IR" detectBrowserContext>
      <CurrentContext />
    </LocaleProvider>,
  );
  fireEvent.focus(window);
  expect(screen.getByTestId("context")).toHaveTextContent("en/UTC/IR/manual");
  first.unmount();
  render(
    <LocaleProvider timeZone="Europe/London" country="GB" detectBrowserContext>
      <CurrentContext />
    </LocaleProvider>,
  );
  fireEvent.focus(window);
  expect(screen.getByTestId("context")).toHaveTextContent("en/Europe/London/GB/-");
  expect(save).not.toHaveBeenCalled();
});

it("preserves a legacy account's effective digits when suggesting a new country", async () => {
  deviceZone = "Europe/Berlin";
  vi.spyOn(navigator, "languages", "get").mockReturnValue(["de-DE"]);
  render(
    <LocaleProvider locale="fa" calendar="persian" timeZone="UTC" detectBrowserContext>
      <CurrentContext />
    </LocaleProvider>,
  );
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      {
        locale: "fa",
        calendar: "persian",
        timeZone: "Europe/Berlin",
        country: "DE",
        timeZoneMode: "browser",
        numberingSystem: "arabext",
      },
      null,
    ),
  );
});

it("does not infer a country from a manual override when the browser zone is unavailable", () => {
  vi.spyOn(navigator, "languages", "get").mockReturnValue(["en"]);
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockImplementation(function (
    this: Intl.DateTimeFormat,
  ) {
    const resolved = actualResolvedOptions.call(this);
    return resolved.timeZone === "Asia/Tehran"
      ? resolved
      : { ...resolved, timeZone: "Invalid/Zone" };
  });
  render(
    <LocaleProvider timeZone="Asia/Tehran" timeZoneMode="manual" detectBrowserContext>
      <CurrentContext />
    </LocaleProvider>,
  );
  expect(screen.getByTestId("context")).toHaveTextContent("en/Asia/Tehran/-/manual");
  expect(save).not.toHaveBeenCalled();
});

it("updates browser mode to Berlin and follows later travel without replacing the saved country", async () => {
  deviceZone = "Europe/Berlin";
  render(
    <LocaleProvider timeZone="UTC" timeZoneMode="browser" country="IR" detectBrowserContext>
      <CurrentContext />
    </LocaleProvider>,
  );
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  expect(screen.getByTestId("context")).toHaveTextContent("en/Europe/Berlin/IR/browser");
  deviceZone = "Asia/Tehran";
  fireEvent.focus(window);
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(screen.getByTestId("context")).toHaveTextContent("en/Asia/Tehran/IR/browser");
});

it("does not retry a failed detection on rerender or repeated focus", async () => {
  save.mockResolvedValue({ ok: false, error: "save_failed" });
  render(
    <LocaleProvider timeZone="UTC" timeZoneMode="browser" country="IR" detectBrowserContext>
      <CurrentContext />
    </LocaleProvider>,
  );
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  fireEvent.focus(window);
  fireEvent.focus(window);
  expect(save).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId("context")).toHaveTextContent("en/UTC/IR/browser");
});

it("does not overwrite an explicit choice queued during browser detection", async () => {
  let finishDetection: ((result: { ok: true }) => void) | undefined;
  save.mockImplementationOnce(
    () =>
      new Promise<{ ok: true }>((resolve) => {
        finishDetection = resolve;
      }),
  );
  render(
    <LocaleProvider timeZone="UTC" timeZoneMode="browser" country="IR" detectBrowserContext>
      <CurrentContext />
    </LocaleProvider>,
  );
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: "Use manual UTC" }));
  deviceZone = "Europe/Berlin";
  fireEvent.focus(window);
  expect(save).toHaveBeenCalledTimes(1);
  finishDetection?.({ ok: true });
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  expect(screen.getByTestId("context")).toHaveTextContent("en/UTC/IR/manual");
});
