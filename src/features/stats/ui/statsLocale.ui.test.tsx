// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { WonTrendWidget } from "./TrendWidget";
import { DealPerformanceWidget } from "./widgets";

afterEach(cleanup);
it("shows Persian performance counts while retaining the original dollar amounts", () => {
  const empty = { count: 0, value: "0" };
  render(
    <LocaleProvider locale="fa">
      <DealPerformanceWidget
        data={{ added: { count: 10, value: "418500" }, won: empty, lost: empty, open: empty }}
        currency="USD"
      />
    </LocaleProvider>,
  );
  expect(screen.getByText("عملکرد فرصت‌های فروش")).toBeInTheDocument();
  expect(screen.getByText("۱۰")).toBeInTheDocument();
  expect(screen.getByText(/۴۱۸٬۵۰۰/)).toBeInTheDocument();
});
it("identifies Gregorian report months in the Persian monthly trend", () => {
  render(
    <LocaleProvider locale="fa">
      <WonTrendWidget data={[{ month: "2026-03", count: 1, value: "1500" }]} currency="USD" />
    </LocaleProvider>,
  );
  expect(screen.getByText("روندهای ماهانه بر پایه ماه‌های تقویم میلادی هستند.")).toBeInTheDocument();
  expect(screen.getByRole("rowheader", { name: /مارس/ })).toHaveTextContent("۲۰۲۶");
});
