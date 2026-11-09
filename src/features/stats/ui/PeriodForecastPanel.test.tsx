// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { NativePeriodForecast } from "../nativePeriodForecast";
import { PeriodForecastPanel } from "./PeriodForecastPanel";
import { readForecastFactor } from "./periodForecastForm";

const fixture = vi.hoisted(() => ({
  mutate: vi.fn(),
  reset: vi.fn(),
  data: undefined as NativePeriodForecast | undefined,
}));

vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    stats: {
      periodForecast: {
        useMutation: () => ({
          mutate: fixture.mutate,
          reset: fixture.reset,
          data: fixture.data,
          isPending: false,
          isError: false,
        }),
      },
    },
  },
}));

vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "forecast-csrf" }));

const scope = { currency: "EUR", pipelineId: null, ownerScope: { kind: "me" } } as const;
const mount = () =>
  render(
    <LocaleProvider locale="en" country="GB" calendar="gregory" timeZone="Europe/Berlin">
      <PeriodForecastPanel today="2026-11-05" scope={scope} />
    </LocaleProvider>,
  );

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  fixture.data = undefined;
});

describe("forecast scenario inputs", () => {
  it("keeps omitted, zero, localized decimal and unsupported precision distinct", () => {
    expect(readForecastFactor(" ", "en-GB", "probability")).toBeNull();
    expect(readForecastFactor("0", "en-GB", "probability")).toBe("0");
    expect(readForecastFactor("۲۵٫۱۲۳۴", "fa-IR", "probability")).toBe("0.251234");
    expect(readForecastFactor("12,5", "de-DE", "probability")).toBe("0.125");
    expect(readForecastFactor("100", "en-GB", "probability")).toBe("1");
    expect(readForecastFactor("100.0001", "en-GB", "probability")).toBeUndefined();
    expect(readForecastFactor("1.00001", "en-GB", "probability")).toBeUndefined();
    expect(readForecastFactor("۰٫۱۲۳۴۵۶", "fa-IR", "size")).toBe("0.123456");
    expect(readForecastFactor("10.000001", "en-GB", "size")).toBeUndefined();
    expect(readForecastFactor("-1", "en-GB", "size")).toBeUndefined();
  });

  it("posts only the selected scope, future target and authored assumptions", async () => {
    const user = userEvent.setup();
    mount();
    const base = within(screen.getByRole("group", { name: "Base" }));
    await user.type(base.getByLabelText("Chance of winning eventually (%)"), "25.5");
    await user.type(base.getByLabelText("Chance of closing in the period if won (%)"), "60");
    await user.type(base.getByLabelText("Deal value multiplier (0–10)"), "1.25");
    await user.click(screen.getByRole("button", { name: "Run scenarios" }));
    expect(fixture.mutate).toHaveBeenCalledWith({
      csrfToken: "forecast-csrf",
      scenario: {
        ...scope,
        policyVersion: 1,
        from: "2026-11-06",
        to: "2026-12-05",
        scenarios: {
          conservative: { pWin: null, pCloseInPeriodGivenWin: null },
          base: { pWin: "0.255", pCloseInPeriodGivenWin: "0.6", sizeMultiplier: "1.25" },
          upside: { pWin: null, pCloseInPeriodGivenWin: null },
        },
      },
    });
    expect(screen.queryByText("Scenario results")).not.toBeInTheDocument();
  });

  it("shows missing capture as unavailable and refuses out-of-bounds inputs", async () => {
    const user = userEvent.setup();
    fixture.data = { state: "unavailable", reason: "capture-not-installed" };
    mount();
    expect(screen.getByRole("alert")).toHaveTextContent("Deal history capture is required");
    const base = within(screen.getByRole("group", { name: "Base" }));
    await user.type(base.getByLabelText("Chance of winning eventually (%)"), "101");
    await user.click(screen.getByRole("button", { name: "Run scenarios" }));
    expect(fixture.mutate).not.toHaveBeenCalled();
    expect(screen.getByText(/Choose a future period/)).toBeVisible();
    expect(screen.queryByText("Scenario results")).not.toBeInTheDocument();
  });
});
