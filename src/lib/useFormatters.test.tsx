import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { useFormatters } from "./useFormatters";

vi.mock("@/features/i18n/LocaleProvider", () => ({
  useLocalePreferences: () => ({ locale: "fa", calendar: "persian", timeZone: "Asia/Tehran" }),
}));

function Sample(): React.ReactNode {
  const format = useFormatters();
  return (
    <p>
      {format.dateOnly("2026-03-21")} | {format.currency("1234", "EUR")} | {format.number(23)}
    </p>
  );
}

describe("useFormatters", () => {
  it("uses the shared selected preferences while preserving the record currency", () => {
    const html = renderToStaticMarkup(<Sample />);
    expect(html).toContain("۱ فروردین ۱۴۰۵");
    expect(html).toContain("۱٬۲۳۴");
    expect(html).toContain("€");
    expect(html).toContain("۲۳");
  });
});
