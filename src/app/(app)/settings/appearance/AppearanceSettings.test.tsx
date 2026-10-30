// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { AppearanceSettings } from "./AppearanceSettings";

const { save, report, choose } = vi.hoisted(() => ({
  save: vi.fn<() => Promise<{ ok: true } | { ok: false; error: { id: string } }>>(() =>
    Promise.resolve({ ok: true }),
  ),
  report: vi.fn(),
  choose: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/features/identity/preferencesActions", () => ({ setDensityAction: save }));
vi.mock("@/features/i18n/actions", () => ({ saveLocalePreferencesAction: vi.fn() }));
vi.mock("@/components/shell/ActionErrorProvider", () => ({ useActionError: () => report }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
vi.mock("@/features/theme/useAppearanceChoice", () => ({
  useAppearanceChoice: () => ({ value: "system", choose }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("saves density separately without sending a stale timezone", async () => {
  render(<AppearanceSettings density="comfortable" appearance="system" />);
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  fireEvent.click(screen.getByRole("radio", { name: "Compact" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await vi.waitFor(() => expect(save).toHaveBeenCalledWith({ density: "compact" }, "csrf"));
  expect(await screen.findByRole("status")).toHaveTextContent("Saved");
});

it("retains the density draft when saving is denied", async () => {
  save.mockResolvedValueOnce({ ok: false, error: { id: "E_AUTH_CSRF" } });
  render(<AppearanceSettings density="comfortable" appearance="system" />);
  fireEvent.click(screen.getByRole("radio", { name: "Compact" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await vi.waitFor(() => expect(report).toHaveBeenCalledWith("E_AUTH_CSRF"));
  expect(screen.getByRole("radio", { name: "Compact" })).toBeChecked();
  expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
});

it("localizes display preferences and save instructions in Farsi", () => {
  render(
    <LocaleProvider locale="fa">
      <AppearanceSettings density="compact" appearance="system" />
    </LocaleProvider>,
  );
  expect(screen.getByRole("combobox", { name: "رنگ‌بندی" })).toBeInTheDocument();
  expect(screen.getByText("تغییرات به‌صورت خودکار ذخیره می‌شوند.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "ذخیره" })).toBeDisabled();
});
