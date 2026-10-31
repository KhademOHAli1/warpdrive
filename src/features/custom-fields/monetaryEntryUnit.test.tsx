// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CurrencyProvider } from "@/features/currencies/CurrencyProvider";
import { createAppTranslator } from "@/features/i18n/catalog";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { CustomFieldDef } from "@/types/customFields";
import { CustomFieldCreateFields } from "./CustomFieldCreateFields";
import { InlineCustomFieldEditor } from "./InlineCustomFieldEditor";
import { CustomFieldFormControl } from "./render.widgets";

vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    identity: { assignableUsers: { useQuery: () => ({ data: [], isLoading: false }) } },
    contacts: {
      personOptions: { useQuery: () => ({ data: [], isLoading: false }) },
      orgOptions: { useQuery: () => ({ data: [], isLoading: false }) },
    },
  },
}));
afterEach(cleanup);

const monetary: CustomFieldDef = {
  id: "cf-budget",
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

it.each(["fa", "de"] as const)(
  "%s toman read view opens an explicitly canonical rial editor without converting input",
  (locale) => {
    const save = vi.fn(() => Promise.resolve({ ok: true as const, value: undefined }));
    render(
      <LocaleProvider locale={locale} iranianMoneyUnit="toman">
        <CurrencyProvider currency="EUR">
          <InlineCustomFieldEditor def={monetary} value={1} currency="IRR" onSave={save} />
        </CurrencyProvider>
      </LocaleProvider>,
    );
    expect(screen.getByText(locale === "fa" ? /۰٫۱.*تومان/u : /0,1.*Toman/u)).toBeInTheDocument();
    const inline = createAppTranslator(locale, "shell.inline");
    fireEvent.click(screen.getByRole("button", { name: inline("edit", { label: "Budget" }) }));

    const input = screen.getByRole("textbox", { name: "Budget" });
    expect(input).toHaveValue(locale === "fa" ? "۱" : "1");
    expect(input).toHaveAccessibleDescription(/IRR/u);
    expect(input).toHaveAccessibleDescription(locale === "fa" ? /ریال/u : /Rial/u);
    expect(input).toHaveAccessibleDescription(
      locale === "fa" ? /واحد ورود مبلغ/u : /Eingabeeinheit/u,
    );
    expect(input).not.toHaveAccessibleDescription(/EUR/u);
    fireEvent.change(input, { target: { value: locale === "fa" ? "۲" : "2" } });
    fireEvent.click(screen.getByRole("button", { name: inline("save") }));
    expect(save).toHaveBeenCalledExactlyOnceWith(2);
  },
);

it.each(["fa", "de"] as const)(
  "%s uses the supplied actual currency in a create form rather than a toman profile",
  (locale) => {
    const change = vi.fn();
    render(
      <LocaleProvider locale={locale} iranianMoneyUnit="toman">
        <CurrencyProvider currency="IRR">
          <CustomFieldCreateFields
            defs={[monetary]}
            values={{ budget: 1 }}
            currency="EUR"
            onChange={change}
          />
        </CurrencyProvider>
      </LocaleProvider>,
    );
    const input = screen.getByRole("textbox", { name: "Budget" });
    expect(input).toHaveAccessibleDescription(/EUR/u);
    expect(input).not.toHaveAccessibleDescription(/IRR|Toman|تومان/u);
    fireEvent.change(input, { target: { value: locale === "fa" ? "۳" : "3" } });
    expect(change).toHaveBeenCalledExactlyOnceWith("budget", 3);
  },
);

it("uses company currency for existing custom fields with no per-field currency metadata", () => {
  render(
    <LocaleProvider locale="de" iranianMoneyUnit="toman">
      <CurrencyProvider currency="IRR">
        <CustomFieldFormControl def={monetary} value={1} onChange={vi.fn()} />
      </CurrencyProvider>
    </LocaleProvider>,
  );
  expect(screen.getByRole("textbox", { name: "Budget" })).toHaveAccessibleDescription(/IRR/u);
});

it("does not attach money entry instructions to ordinary numeric fields", () => {
  render(
    <LocaleProvider locale="fa" iranianMoneyUnit="toman">
      <CurrencyProvider currency="IRR">
        <CustomFieldFormControl
          def={{ ...monetary, type: "numeric" }}
          value={1}
          onChange={vi.fn()}
        />
      </CurrencyProvider>
    </LocaleProvider>,
  );
  expect(screen.getByRole("textbox", { name: "Budget" })).not.toHaveAccessibleDescription();
});
