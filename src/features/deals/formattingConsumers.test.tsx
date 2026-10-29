// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BoardSummary } from "./BoardSummary";
import { DealCard } from "./DealCard";
import { baseCard } from "./dealCardTestFixture";

vi.mock("@/features/i18n/LocaleProvider", async () => ({
  ...(await vi.importActual("@/features/i18n/LocaleProvider")),
  useLocalePreferences: () => ({ locale: "fa", calendar: "persian", timeZone: "Asia/Tehran" }),
}));

afterEach(cleanup);

describe("localized pipeline values", () => {
  it("renders deal values in Persian using the configured business currency", () => {
    render(
      <DealCard
        card={{ ...baseCard, value: "1234" }}
        currency="EUR"
        ownerName="Ali"
        personName={null}
        orgName={null}
        labels={[]}
        rottingDays={null}
        density="comfortable"
        now={new Date("2026-03-21T12:00:00Z")}
      />,
    );
    expect(screen.getByText(/۱٬۲۳۴/).textContent).toContain("€");
  });

  it("uses the same locale and currency for the pipeline total", () => {
    render(<BoardSummary totalValue="1234" dealCount={2} currency="EUR" />);
    fireEvent.click(screen.getByRole("button", { name: "Show deals total value" }));
    expect(screen.getByText(/۱٬۲۳۴/).textContent).toContain("€");
  });
});
