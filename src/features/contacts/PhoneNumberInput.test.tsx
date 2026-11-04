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

const savePreferences = vi.hoisted(() => vi.fn(() => Promise.resolve({ ok: true })));
vi.mock("@/features/i18n/actions", () => ({ saveLocalePreferencesAction: savePreferences }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.documentElement.removeAttribute("dir");
  document.documentElement.removeAttribute("lang");
});
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

const guidanceCases = [
  {
    locale: "en",
    countryLabel: "Phone: Phone number country",
    countryName: "Germany (+49)",
    raw: "030 23125 000",
    normalized: "International format: +493023125000",
    chooseCountry: "Choose a country or enter the number with + and its country code.",
    review: "Check the number before calling or messaging. Your original entry is preserved.",
    extension: "This number has an extension. Review the recipient before calling or messaging.",
  },
  {
    locale: "de",
    countryLabel: "Phone: Land der Telefonnummer",
    countryName: "Deutschland (+49)",
    raw: "030 23125 000",
    normalized: "Internationales Format: +493023125000",
    chooseCountry: "Wählen Sie ein Land oder beginnen Sie die Nummer mit + und der Ländervorwahl.",
    review:
      "Prüfen Sie die Nummer vor einem Anruf oder einer Nachricht. Ihre Eingabe bleibt unverändert.",
    extension:
      "Diese Nummer enthält eine Durchwahl. Prüfen Sie den Empfänger vor einem Anruf oder einer Nachricht.",
  },
  {
    locale: "fa",
    countryLabel: "Phone: کشور شماره تلفن",
    countryName: "ایران (+98)",
    raw: " ۰۹۱۲ ۳۴۵ ۶۷۸۹ ",
    normalized: "قالب بین‌المللی: +989123456789",
    chooseCountry: "کشور را انتخاب کنید یا شماره را با «+» و پیش‌شمارهٔ کشور وارد کنید.",
    review: "پیش از تماس یا ارسال پیام، شماره را بررسی کنید. متن واردشده حفظ می‌شود.",
    extension: "این شماره داخلی دارد. پیش از تماس یا ارسال پیام، گیرنده را بررسی کنید.",
  },
] as const;

it.each(guidanceCases)(
  "associates the current $locale country, normalized and review guidance without changing raw input",
  async (copy) => {
    const user = userEvent.setup();
    render(<Harness locale={copy.locale} />);
    const phone = screen.getByRole("textbox", { name: "Phone" });
    expect(phone).not.toHaveAttribute("aria-describedby");
    fireEvent.change(phone, { target: { value: copy.raw } });
    expect(phone).toHaveAccessibleDescription(copy.chooseCountry);
    const guidanceId = phone.getAttribute("aria-describedby");
    if (guidanceId === null) throw new Error("Phone guidance is not associated");
    expect(document.getElementById(guidanceId)).toHaveAttribute("aria-live", "polite");
    await user.click(screen.getByRole("combobox", { name: copy.countryLabel }));
    await user.click(screen.getByRole("option", { name: copy.countryName }));
    expect(phone).toHaveAccessibleDescription(copy.normalized);
    expect(phone).toHaveAttribute("aria-describedby", guidanceId);
    expect(phone).toHaveValue(copy.raw);
    expect(screen.getByTestId("raw").textContent).toBe(copy.raw);

    const reviewRaw = "not a phone number";
    fireEvent.change(phone, { target: { value: reviewRaw } });
    expect(phone).toHaveAccessibleDescription(copy.review);
    expect(phone).toHaveAttribute("aria-describedby", guidanceId);
    expect(phone).not.toHaveAttribute("aria-invalid", "true");
    expect(phone).toHaveValue(reviewRaw);
    expect(screen.getByTestId("raw").textContent).toBe(reviewRaw);

    const extensionRaw = "+49 30 23125000 ext. 12";
    fireEvent.change(phone, { target: { value: extensionRaw } });
    expect(phone).toHaveAccessibleDescription(copy.extension);
    expect(phone).toHaveAttribute("aria-describedby", guidanceId);
    expect(phone).not.toHaveAttribute("aria-invalid", "true");
    expect(phone).toHaveValue(extensionRaw);
    expect(screen.getByTestId("raw").textContent).toBe(extensionRaw);

    fireEvent.change(phone, { target: { value: "   " } });
    expect(phone).not.toHaveAttribute("aria-describedby");
    expect(document.getElementById(guidanceId)).not.toBeInTheDocument();
    expect(phone).toHaveValue("   ");
    expect(screen.getByTestId("raw").textContent).toBe("   ");
    expect(screen.getByRole("combobox", { name: copy.countryLabel })).toHaveTextContent(
      copy.countryName,
    );
    expect(savePreferences).not.toHaveBeenCalled();
  },
);

it("keeps descriptions unique between phone instances and preserves caller input ids", () => {
  const change = vi.fn();
  const changeCountry = vi.fn();
  render(
    <LocaleProvider locale="en">
      <PhoneNumberInput
        id="caller-primary-phone"
        ariaLabel="Primary phone"
        value="+49 30 23125000"
        country="DE"
        onChange={change}
        onCountryChange={changeCountry}
      />
      <PhoneNumberInput
        id="caller-secondary-phone"
        ariaLabel="Secondary phone"
        value="not a phone number"
        country="DE"
        onChange={change}
        onCountryChange={changeCountry}
      />
      <PhoneNumberInput
        ariaLabel="Empty phone"
        value=""
        onChange={change}
        onCountryChange={changeCountry}
      />
    </LocaleProvider>,
  );
  const primary = screen.getByRole("textbox", { name: "Primary phone" });
  const secondary = screen.getByRole("textbox", { name: "Secondary phone" });
  const primaryDescription = primary.getAttribute("aria-describedby");
  const secondaryDescription = secondary.getAttribute("aria-describedby");
  expect(primaryDescription).not.toBeNull();
  expect(secondaryDescription).not.toBeNull();
  expect(primaryDescription).not.toBe(secondaryDescription);
  expect(primary).toHaveAccessibleDescription(guidanceCases[0].normalized);
  expect(secondary).toHaveAccessibleDescription(guidanceCases[0].review);
  expect(primary).toHaveAttribute("id", "caller-primary-phone");
  expect(secondary).toHaveAttribute("id", "caller-secondary-phone");
  expect(screen.getByRole("textbox", { name: "Empty phone" })).not.toHaveAttribute(
    "aria-describedby",
  );
  expect(change).not.toHaveBeenCalled();
  expect(changeCountry).not.toHaveBeenCalled();
  expect(savePreferences).not.toHaveBeenCalled();
});
