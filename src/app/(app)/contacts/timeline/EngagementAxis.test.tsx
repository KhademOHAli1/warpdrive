// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { EngagementAxis, monthLabel } from "./EngagementAxis";

afterEach(cleanup);

describe("EngagementAxis", () => {
  it("uses German month and current-column names without rebucketing saved periods", () => {
    render(
      <LocaleProvider locale="de" calendar="persian">
        <table>
          <EngagementAxis months={["2026-03", "2026-04"]} />
        </table>
      </LocaleProvider>,
    );
    expect(screen.getByRole("columnheader", { name: "März 2026" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Heute" })).toBeInTheDocument();
    expect(monthLabel("2026-03", "fa", "latn")).toContain("2026");
    expect(monthLabel("custom-period", "de")).toBe("custom-period");
  });
  it("labels the rightmost (current) month 'Today' like Pipedrive", () => {
    render(
      <table>
        <EngagementAxis months={["2026-05", "2026-06", "2026-07"]} />
      </table>,
    );
    // Past months keep their name; the last column reads Today, not the month name.
    expect(screen.getByText("May 2026")).toBeInTheDocument();
    expect(screen.getByText("Jun 2026")).toBeInTheDocument();
    expect(screen.getByText("Today")).toBeInTheDocument();
    expect(screen.queryByText("Jul 2026")).not.toBeInTheDocument();
    expect(screen.getByText("Contact")).toHaveClass("sticky", "start-0");
  });
});

describe("monthLabel", () => {
  it("formats a YYYY-MM key as 'Mon YYYY'", () => {
    expect(monthLabel("2026-04")).toBe("Apr 2026");
  });
});
