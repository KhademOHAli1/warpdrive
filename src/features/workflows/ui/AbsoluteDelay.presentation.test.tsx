// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { formatDateTime } from "@/lib/localeFormatting";
import english from "../messages/workflows.en.json";
import type { WorkflowNode } from "../schemas";
import { NodeSummary } from "./NodeSummary";
import { WaitTimestamp } from "./WaitTimestamp";

afterEach(cleanup);
const raw = "2030-03-20T14:34:56.123000000+02:00";
const canonical = "2030-03-20T12:34:56.123Z";
function expectExactTimestamp(time: Element | null | undefined, exact: string) {
  expect(time).toBeInTheDocument();
  // Native time semantics remain unnamed; a readable description supplies the
  // exact authored/stored instant without changing the visible localized string.
  expect(time).not.toHaveAttribute("aria-label");
  expect(time).toHaveAccessibleDescription(expect.stringContaining(exact));
  const descriptionId = time?.getAttribute("aria-describedby");
  expect(descriptionId).toBeTruthy();
  const description =
    typeof descriptionId === "string" ? document.getElementById(descriptionId) : null;
  expect(description).toHaveTextContent(exact);
  expect(description).not.toHaveAttribute("aria-hidden", "true");
  expect(time?.parentElement).toHaveTextContent(exact);
}
function node(value: string): WorkflowNode {
  return {
    id: "wait",
    type: "delay",
    version: 1,
    name: "Wait",
    config: { until: { kind: "value", literalType: "instant", value } },
  };
}
const profiles = [
  { name: "English", locale: "en", calendar: "gregory", numberingSystem: "latn", timeZone: "UTC" },
  {
    name: "German",
    locale: "de",
    calendar: "gregory",
    numberingSystem: "latn",
    timeZone: "Europe/Berlin",
  },
  {
    name: "Persian calendar and digits",
    locale: "fa",
    calendar: "persian",
    numberingSystem: "arabext",
    timeZone: "Asia/Tehran",
  },
  {
    name: "Persian language Gregorian Latin display",
    locale: "fa",
    calendar: "gregory",
    numberingSystem: "latn",
    timeZone: "UTC",
  },
] as const;

it.each(profiles)(
  "summarizes the localized precise instant and exposes exact authored text in $name",
  (profile) => {
    const wait = node(raw);
    const view = render(
      <LocaleProvider {...profile}>
        <NodeSummary node={wait} />
      </LocaleProvider>,
    );
    const expected = formatDateTime(new Date(raw), profile, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      fractionalSecondDigits: 3,
      timeZoneName: "short",
    });
    const time = view.container.querySelector("time");
    expect(time).toHaveTextContent(expected);
    expect(time).toHaveAttribute("datetime", canonical);
    expectExactTimestamp(time, raw);
    expect(wait.config).toEqual(node(raw).config);
  },
);

it.each(profiles)(
  "keeps a stored deadline fixed when history display preferences change in $name",
  (profile) => {
    const deadline = new Date(canonical);
    const view = render(
      <LocaleProvider locale="en" timeZone="UTC">
        <WaitTimestamp value={deadline} label={english.scheduledResume} />
      </LocaleProvider>,
    );
    const previous = view.container.querySelector("time")?.textContent;
    view.rerender(
      <LocaleProvider {...profile}>
        <WaitTimestamp value={deadline} label={english.scheduledResume} />
      </LocaleProvider>,
    );
    const time = view.container.querySelector("time");
    expect(time).toHaveAttribute("datetime", canonical);
    expectExactTimestamp(time, canonical);
    if (profile.locale !== "en") expect(time?.textContent).not.toBe(previous);
    expect(deadline.toISOString()).toBe(canonical);
  },
);

it("preserves the legacy default minute display while exposing the exact stored deadline accessibly", () => {
  const deadline = new Date(canonical);
  const view = render(
    <LocaleProvider locale="en" timeZone="UTC">
      <WaitTimestamp value={deadline} label={english.scheduledResume} />
    </LocaleProvider>,
  );
  const expected = formatDateTime(
    deadline,
    { locale: "en", timeZone: "UTC" },
    {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    },
  );
  const time = view.container.querySelector("time");
  expect(time?.textContent).toBe(expected);
  expectExactTimestamp(time, canonical);
});

it("distinguishes second and millisecond targets visibly as well as accessibly", () => {
  const view = render(
    <LocaleProvider locale="en" timeZone="UTC">
      <NodeSummary node={node("2030-03-20T12:34:01.001Z")} />
      <NodeSummary node={node("2030-03-20T12:34:02.002Z")} />
    </LocaleProvider>,
  );
  const times = [...view.container.querySelectorAll("time")];
  expect(times).toHaveLength(2);
  expect(times[0]?.textContent).not.toBe(times[1]?.textContent);
  expectExactTimestamp(times[0], "2030-03-20T12:34:01.001Z");
  expectExactTimestamp(times[1], "2030-03-20T12:34:02.002Z");
});

it.each(["2030-03-20", "2030-03-20T12:34:56.1234Z"])(
  "does not present an invalid fixed draft %s as a scheduled instant",
  (value) => {
    const view = render(
      <LocaleProvider locale="en">
        <NodeSummary node={node(value)} />
      </LocaleProvider>,
    );
    expect(screen.getByText(english.setupRequired)).toBeVisible();
    expect(view.container.querySelector("time")).toBeNull();
  },
);

it("keeps unavailable stored timing readable without manufacturing a deadline", () => {
  const view = render(
    <LocaleProvider locale="en">
      <WaitTimestamp value={null} label={english.scheduledResume} />
    </LocaleProvider>,
  );
  expect(screen.getByText(english.waitTimingUnavailable)).toBeVisible();
  expect(view.container.querySelector("time")).toBeNull();
});
