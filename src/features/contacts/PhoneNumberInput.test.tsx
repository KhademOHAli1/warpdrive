// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { Locale } from "@/features/i18n/registry";
import type { PhoneCountry } from "@/utils/phoneNormalization";
import { PhoneNumberInput } from "./PhoneNumberInput";

vi.mock("@/features/i18n/actions", () => ({
  saveLocalePreferencesAction: () => Promise.resolve({ ok: true }),
}));
afterEach(cleanup);
function Harness({ locale }: { locale: Locale }) {
  const [value, setValue] = useState("");
  const [country, setCountry] = useState<PhoneCountry>();
  return (
    <LocaleProvider locale={locale}>
      <PhoneNumberInput
        value={value}
        country={country}
        onChange={setValue}
        onCountryChange={setCountry}
        ariaLabel="Phone"
      />
      <output data-testid="raw">{value}</output>
    </LocaleProvider>
  );
}
it.each([
  ["fa", "Phone: کشور شماره تلفن", "ایران (+98)", " ۰۹۱۲ ۳۴۵ ۶۷۸۹ ", "+989123456789"],
  ["de", "Phone: Land der Telefonnummer", "Deutschland (+49)", "030 23125 000", "+493023125000"],
] as const)(
  "completes a localized %s country selection while preserving original input",
  async (locale, countryLabel, countryName, raw, expected) => {
    const user = userEvent.setup();
    render(<Harness locale={locale} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Phone" }), { target: { value: raw } });
    expect(screen.queryByText(expected)).not.toBeInTheDocument();
    await user.click(screen.getByRole("combobox", { name: countryLabel }));
    await user.click(screen.getByRole("option", { name: countryName }));
    expect(screen.getByText(expected)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Phone" })).toHaveValue(raw);
    expect(screen.getByTestId("raw").textContent).toBe(raw);
  },
);
