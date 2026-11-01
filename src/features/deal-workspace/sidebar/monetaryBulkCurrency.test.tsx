// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CurrencyProvider } from "@/features/currencies/CurrencyProvider";
import { createAppTranslator } from "@/features/i18n/catalog";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { CustomFieldDef } from "@/types/customFields";
import { DetailsBlock } from "./DetailsBlock";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/features/i18n/actions", () => ({ saveLocalePreferencesAction: vi.fn() }));
vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    identity: { assignableUsers: { useQuery: () => ({ data: [], isLoading: false }) } },
    contacts: {
      personOptions: { useQuery: () => ({ data: [], isLoading: false }) },
      orgOptions: { useQuery: () => ({ data: [], isLoading: false }) },
    },
  },
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const budget: CustomFieldDef = {
  id: "deal-budget",
  key: "budget",
  targetEntity: "deal",
  type: "monetary",
  name: "Budget",
  options: [],
  isRequired: false,
  isImportant: false,
  showInAddForm: true,
  order: 0,
  archivedAt: null,
};

it.each([
  { locale: "fa", numberingSystem: "latn", one: "1", two: "2" },
  { locale: "de", numberingSystem: "arabext", one: "۱", two: "۲" },
  { locale: "en", numberingSystem: "arabext", one: "۱", two: "۲" },
] as const)(
  "$locale/$numberingSystem keeps explicit IRR entry canonical through inline and bulk editing",
  async ({ locale, numberingSystem, one, two }) => {
    const save = vi.fn(() => Promise.resolve({ ok: true as const, value: undefined }));
    const exit = vi.fn();
    const inline = createAppTranslator(locale, "shell.inline");
    const block = (bulkEditing: boolean) => (
      <LocaleProvider
        locale={locale}
        numberingSystem={numberingSystem}
        iranianMoneyUnit="toman"
      >
        <CurrencyProvider currency="EUR">
          <DetailsBlock
            currency="IRR"
            customFieldDefs={[budget]}
            customFields={{ budget: 1 }}
            onSave={save}
            bulkEditing={bulkEditing}
            onExitBulk={exit}
          />
        </CurrencyProvider>
      </LocaleProvider>
    );
    const view = render(block(false));
    expect(screen.getByText(locale === "fa" ? /تومان/u : /Toman/iu)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: inline("edit", { label: "Budget" }) }));
    const inlineInput = screen.getByRole("textbox", { name: "Budget" });
    expect(inlineInput).toHaveValue(one);
    expect(inlineInput).toHaveAccessibleDescription(/IRR/u);
    expect(inlineInput).toHaveAccessibleDescription(locale === "fa" ? /ریال/u : /Rial/u);
    expect(inlineInput).not.toHaveAccessibleDescription(/EUR|Toman|تومان/iu);
    fireEvent.click(screen.getByRole("button", { name: inline("cancel") }));

    view.rerender(block(true));
    const bulkInput = screen.getByRole("textbox", { name: "Budget" });
    expect(bulkInput).toHaveValue(one);
    expect(bulkInput).toHaveAccessibleDescription(/IRR/u);
    expect(bulkInput).toHaveAccessibleDescription(locale === "fa" ? /ریال/u : /Rial/u);
    expect(bulkInput).not.toHaveAccessibleDescription(/EUR|Toman|تومان/iu);

    // An untouched canonical amount exits without a write, rather than rescaling one rial.
    fireEvent.click(screen.getByRole("button", { name: inline("save") }));
    expect(exit).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();

    fireEvent.change(bulkInput, { target: { value: two } });
    fireEvent.click(screen.getByRole("button", { name: inline("save") }));
    await waitFor(() => expect(save).toHaveBeenCalledExactlyOnceWith({ budget: 2 }));
    await waitFor(() => expect(exit).toHaveBeenCalledTimes(2));
    expect(refresh).toHaveBeenCalledTimes(1);
  },
);
