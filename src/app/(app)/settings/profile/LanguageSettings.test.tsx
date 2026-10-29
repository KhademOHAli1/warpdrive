// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { useFormatters } from "@/lib/useFormatters";
import { LanguageSettings } from "./LanguageSettings";

const { save } = vi.hoisted(() => ({ save: vi.fn(() => Promise.resolve({ ok: true })) }));
vi.mock("@/features/i18n/actions", () => ({ saveLocalePreferencesAction: save }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "test-csrf" }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function Preview() {
  const format = useFormatters();
  return <output data-testid="number">{format.number(1234.5)}</output>;
}

it("shows the digit setting only after choosing Farsi", async () => {
  const user = userEvent.setup();
  render(
    <LocaleProvider>
      <LanguageSettings />
    </LocaleProvider>,
  );
  expect(screen.queryByRole("combobox", { name: "Number display" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("combobox", { name: "Language" }));
  await user.click(screen.getByRole("option", { name: "فارسی" }));
  expect(await screen.findByRole("combobox", { name: "نمایش اعداد" })).toBeInTheDocument();
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ locale: "fa" }), "test-csrf"),
  );
});

it("saves English digits while keeping Farsi text and unfinished input", async () => {
  const user = userEvent.setup();
  render(
    <LocaleProvider locale="fa">
      <LanguageSettings />
      <Preview />
      <input aria-label="draft" defaultValue="" />
    </LocaleProvider>,
  );
  fireEvent.change(screen.getByLabelText("draft"), { target: { value: "یادداشت ناتمام" } });
  expect(screen.getByTestId("number")).toHaveTextContent("۱٬۲۳۴٫۵");
  await user.click(screen.getByRole("combobox", { name: "نمایش اعداد" }));
  await user.click(screen.getByRole("option", { name: "اعداد انگلیسی (123)" }));
  expect(screen.getByTestId("number")).toHaveTextContent("1,234.5");
  expect(screen.getByLabelText("draft")).toHaveValue("یادداشت ناتمام");
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ locale: "fa", numberingSystem: "latn" }),
      "test-csrf",
    ),
  );
});
