// @vitest-environment jsdom
import "./__fixtures__/NativeSubjectReviewFieldIcuTestKit";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { Locale } from "@/features/i18n/registry";
import { formatNumber } from "@/lib/localeFormatting";
import type { NumberingSystem } from "@/lib/numberingSystem";
import { privacyNativeSubjectReviewMessagesForLocale } from "../privacyNativeSubjectReviewMessages";
import { NativeSourcePoints, NativeSourceText } from "./NativeSubjectReviewField";

afterEach(cleanup);
const templates = {
  en: "Page {current} of {total}; repeat {current} / {total}",
  de: "Seite {current} von {total}; erneut {current} / {total}",
  fa: "صفحهٔ {current} از {total}؛ تکرار {current} / {total}",
};
function pageLabel(
  locale: Locale,
  numberingSystem: NumberingSystem,
  current: number,
  total: number,
) {
  const currentLabel = formatNumber(current, { locale, numberingSystem });
  const totalLabel = formatNumber(total, { locale, numberingSystem });
  if (locale === "de")
    return `Seite ${currentLabel} von ${totalLabel}; erneut ${currentLabel} / ${totalLabel}`;
  if (locale === "fa")
    return `صفحهٔ ${currentLabel} از ${totalLabel}؛ تکرار ${currentLabel} / ${totalLabel}`;
  return `Page ${currentLabel} of ${totalLabel}; repeat ${currentLabel} / ${totalLabel}`;
}
const textCases = [
  ["en", "latn"],
  ["de", "arabext"],
  ["fa", "arabext"],
] as const;
const pointCases = [
  ["en", "arabext"],
  ["de", "latn"],
  ["fa", "latn"],
] as const;

for (const [locale, numberingSystem] of textCases)
  test(`${locale}/${numberingSystem} text pagination formats every repeated ICU occurrence`, () => {
    const L = {
      ...privacyNativeSubjectReviewMessagesForLocale(locale),
      pageCount: templates[locale],
    };
    const first = "x".repeat(4000);
    const last = "FINAL-SOURCE-TEXT";
    render(
      <LocaleProvider locale={locale} numberingSystem={numberingSystem} timeZone="UTC">
        <NativeSourceText value={first + last} L={L} />
      </LocaleProvider>,
    );
    const segment = () => screen.getByRole("document", { name: L.segment });
    expect(segment().textContent).toBe(first);
    expect(screen.getByText(pageLabel(locale, numberingSystem, 1, 2))).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\{(?:current|total)\}/u);
    fireEvent.click(screen.getByRole("button", { name: L.nextText }));
    expect(segment().textContent).toBe(last);
    expect(first + segment().textContent).toBe(first + last);
    expect(screen.getByText(pageLabel(locale, numberingSystem, 2, 2))).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\{(?:current|total)\}/u);
    expect(screen.getByRole("button", { name: L.nextText })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: L.previousText }));
    expect(segment().textContent).toBe(first);
    expect(screen.getByText(pageLabel(locale, numberingSystem, 1, 2))).toBeInTheDocument();
  });

for (const [locale, numberingSystem] of pointCases)
  test(`${locale}/${numberingSystem} contact pagination formats every repeated ICU occurrence`, () => {
    const L = {
      ...privacyNativeSubjectReviewMessagesForLocale(locale),
      pageCount: templates[locale],
    };
    const points = Array.from({ length: 21 }, (_, index) => ({
      label: `Synthetic point ${index + 1}`,
      value: `icu-point-${index + 1}@example.test`,
    }));
    render(
      <LocaleProvider locale={locale} numberingSystem={numberingSystem} timeZone="UTC">
        <dl>
          <NativeSourcePoints label={L.emails} points={points} L={L} />
        </dl>
      </LocaleProvider>,
    );
    const field = within(screen.getByRole("group", { name: L.emails }));
    expect(field.getAllByRole("listitem")).toHaveLength(20);
    expect(field.getByText("icu-point-1@example.test")).toBeInTheDocument();
    expect(field.queryByText("icu-point-21@example.test")).not.toBeInTheDocument();
    expect(field.getByText(pageLabel(locale, numberingSystem, 1, 2))).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\{(?:current|total)\}/u);
    fireEvent.click(field.getByRole("button", { name: L.nextPoints }));
    expect(field.getAllByRole("listitem")).toHaveLength(1);
    expect(field.getByText("icu-point-21@example.test")).toBeInTheDocument();
    expect(field.queryByText("icu-point-1@example.test")).not.toBeInTheDocument();
    expect(field.getByText(pageLabel(locale, numberingSystem, 2, 2))).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\{(?:current|total)\}/u);
    expect(field.getByRole("button", { name: L.nextPoints })).toBeDisabled();
    fireEvent.click(field.getByRole("button", { name: L.previousPoints }));
    expect(field.getByText("icu-point-1@example.test")).toBeInTheDocument();
    expect(field.getByText(pageLabel(locale, numberingSystem, 1, 2))).toBeInTheDocument();
  });

test("text page counts preserve ICU quoted literal placeholders while formatting active arguments", () => {
  const L = {
    ...privacyNativeSubjectReviewMessagesForLocale("en"),
    pageCount: "Page '{current}' / '{total}': {current} of {total}",
  };
  render(
    <LocaleProvider locale="en" numberingSystem="latn" timeZone="UTC">
      <NativeSourceText value={`${"x".repeat(4000)}FINAL-LITERAL-SEGMENT`} L={L} />
    </LocaleProvider>,
  );
  expect(screen.getByRole("document", { name: L.segment }).textContent).toHaveLength(4000);
  expect(screen.getByText("Page {current} / {total}: 1 of 2")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: L.nextText }));
  expect(screen.getByRole("document", { name: L.segment })).toHaveTextContent(
    "FINAL-LITERAL-SEGMENT",
  );
  expect(screen.getByText("Page {current} / {total}: 2 of 2")).toBeInTheDocument();
});
