// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider, useLocalePreferences, useSetLocalePreferences } from "./LocaleProvider";

const save = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({ saveLocalePreferencesAction: save }));

function EditingFixture() {
  const preferences = useLocalePreferences();
  const choose = useSetLocalePreferences();
  return (
    <>
      <input aria-label="Unsaved title" defaultValue="Original title" />
      <p>
        {preferences.locale}/{preferences.calendar}/{preferences.timeZone}
      </p>
      <button type="button" onClick={() => void choose({ locale: "fa" })}>
        Choose Persian
      </button>
      <button type="button" onClick={() => void choose({ calendar: "persian" })}>
        Choose Iranian calendar
      </button>
    </>
  );
}

afterEach(() => {
  cleanup();
  save.mockReset();
});

describe("language changes while editing", () => {
  it("persists preferences without remounting or clearing unsaved form input", async () => {
    save.mockResolvedValue({ ok: true });
    render(
      <LocaleProvider locale="en">
        <EditingFixture />
      </LocaleProvider>,
    );
    fireEvent.change(screen.getByLabelText("Unsaved title"), {
      target: { value: "My unsaved draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Choose Persian" }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        { locale: "fa", calendar: "gregory", timeZone: "UTC" },
        null,
      ),
    );
    expect(screen.getByLabelText("Unsaved title")).toHaveValue("My unsaved draft");
    expect(document.documentElement).toHaveAttribute("lang", "fa");
    expect(document.documentElement).toHaveAttribute("dir", "rtl");
  });

  it("reverts a failed save visibly while keeping the unsaved draft", async () => {
    save.mockResolvedValue({ ok: false, error: "save_failed" });
    render(
      <LocaleProvider locale="en">
        <EditingFixture />
      </LocaleProvider>,
    );
    fireEvent.change(screen.getByLabelText("Unsaved title"), {
      target: { value: "Keep this draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Choose Persian" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("could not be saved");
    expect(screen.getByText("en/gregory/UTC")).toBeInTheDocument();
    expect(screen.getByLabelText("Unsaved title")).toHaveValue("Keep this draft");
  });

  it("persists a calendar choice independently of interface language", async () => {
    save.mockResolvedValue({ ok: true });
    render(
      <LocaleProvider locale="en">
        <EditingFixture />
      </LocaleProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Choose Iranian calendar" }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        { locale: "en", calendar: "persian", timeZone: "UTC" },
        null,
      ),
    );
    expect(screen.getByText("en/persian/UTC")).toBeInTheDocument();
  });
});
