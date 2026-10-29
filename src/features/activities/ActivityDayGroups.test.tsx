// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { ActivityDayGroups } from "./ActivityDayGroups";
import { isoToDayHeading } from "./dayHeading";

describe("ActivityDayGroups", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  it("renders a day header per distinct due-day and a No date group", () => {
    const rows = [
      { id: "1", subject: "A", dueAtIso: "2026-07-04T09:00:00.000Z" },
      { id: "2", subject: "B", dueAtIso: "2026-07-04T15:00:00.000Z" },
      { id: "3", subject: "C", dueAtIso: null },
    ] as never[];
    render(
      <ActivityDayGroups
        rows={rows}
        columnCount={5}
        renderRow={(r) => <div key={r.id}>{r.subject}</div>}
      />,
    );
    // one header for Jul 4, one "No date" header
    expect(screen.getByText(/No date/i)).toBeInTheDocument();
    expect(screen.getAllByRole("heading").length).toBe(2);
  });

  it("groups a row by its account due-day when it differs from UTC", () => {
    vi.stubEnv("TZ", "UTC");
    // 2026-07-05T02:00:00Z is 2026-07-04 19:00 (7:00 PM) in America/Los_Angeles (PDT, UTC-7).
    // ActivityRow's fmtDue() renders this row's Due cell via toLocaleString() in LOCAL time,
    // i.e. "Jul 4, 7:00 PM". The day-group header must agree with that LOCAL day, not the
    // UTC calendar day (Jul 5) that a naive ISO-string slice would produce.
    const rows = [
      { id: "1", subject: "Late call", dueAtIso: "2026-07-05T02:00:00.000Z" },
    ] as never[];
    render(
      <LocaleProvider timeZone="America/Los_Angeles">
        <ActivityDayGroups
          rows={rows}
          columnCount={5}
          renderRow={(r) => <div key={r.id}>{r.subject}</div>}
        />
      </LocaleProvider>,
    );
    expect(screen.getByText(isoToDayHeading("2026-07-04"))).toBeInTheDocument();
    expect(screen.queryByText(isoToDayHeading("2026-07-05"))).not.toBeInTheDocument();
  });
});
