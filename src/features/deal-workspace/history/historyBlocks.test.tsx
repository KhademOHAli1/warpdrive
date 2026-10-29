// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatTimelineEmailDate } from "@/features/email/inboxDate";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { AttributionLine } from "./AttributionLine";
import { CreatedCard } from "./CreatedCard";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-02T15:42:00Z"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const AT = new Date("2026-07-02T15:37:00Z");

describe("AttributionLine", () => {
  it("renders a <time> with the actor and (Web App) source", () => {
    render(<AttributionLine at={AT} actorName="Nick Sawinyh" />);
    const time = document.querySelector("time");
    expect(time).toHaveAttribute("dateTime", AT.toISOString());
    const actor = screen.getByText("Nick Sawinyh");
    expect(actor.tagName).toBe("BDI");
    expect(actor).toHaveAttribute("dir", "auto");
    expect(actor.closest("p")).toHaveTextContent("Nick Sawinyh (Web App)");
  });

  it("dates a row the way the email cards in the same feed do", () => {
    render(<AttributionLine at={AT} actorName="Nick Sawinyh" />);
    const time = document.querySelector("time");
    expect(time?.textContent).toBe(
      formatTimelineEmailDate(AT.toISOString(), undefined, {
        locale: "en",
        calendar: "gregory",
        timeZone: "UTC",
      }),
    );
  });

  it("keeps relative feed dates consistent in the selected Persian account zone", () => {
    render(
      <LocaleProvider locale="fa" calendar="persian" timeZone="Asia/Tehran">
        <AttributionLine at={AT} actorName="بهرام" />
      </LocaleProvider>,
    );
    expect(document.querySelector("time")).toHaveTextContent(
      formatTimelineEmailDate(AT.toISOString(), undefined, {
        locale: "fa",
        calendar: "persian",
        timeZone: "Asia/Tehran",
      }),
    );
    expect(document.querySelector("time")).toHaveAttribute("dateTime", AT.toISOString());
  });

  it("humanizes an email-shaped actor name instead of leaking the email", () => {
    render(<AttributionLine at={AT} actorName="demo1@example.com" />);
    expect(screen.queryByText(/demo1@example\.com/)).not.toBeInTheDocument();
    expect(screen.getByText("Demo1").closest("p")).toHaveTextContent("Demo1 (Web App)");
  });

  it("shows a neutral fallback (not an email or 'null') when the actor is null", () => {
    render(<AttributionLine at={AT} actorName={null} />);
    expect(screen.queryByText(/Web App/)).not.toBeInTheDocument();
    expect(screen.queryByText(/@/)).not.toBeInTheDocument();
    expect(screen.getByText(/Unknown/)).toBeInTheDocument();
    expect(document.querySelector("time")).toHaveAttribute("dateTime", AT.toISOString());
  });
});

describe("CreatedCard", () => {
  it("renders the 'Deal created' title with a timestamped attribution", () => {
    render(<CreatedCard at={AT} actorName="Nick" />);
    expect(screen.getByText("Deal created")).toBeInTheDocument();
    expect(screen.getByText("Nick").closest("p")).toHaveTextContent("Nick (Web App)");
    expect(document.querySelector("time")).toHaveAttribute("dateTime", AT.toISOString());
  });
});
