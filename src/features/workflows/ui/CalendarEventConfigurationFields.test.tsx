// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { WorkflowNode } from "../schemas";
import { CalendarEventConfigurationFields } from "./CalendarEventConfigurationFields";

afterEach(cleanup);

const instant = (value: string) => ({ kind: "value", literalType: "instant", value }) as const;
const timed = {
  timeZone: "Europe/Berlin",
  allDay: false,
  startsAt: instant("2026-11-09T23:30:00Z"),
  endsAt: instant("2026-11-10T10:00:00Z"),
};

function Harness({
  initial = {},
  editable = true,
  onChange,
}: {
  initial?: WorkflowNode["config"];
  editable?: boolean;
  onChange: (node: WorkflowNode) => void;
}) {
  const [node, setNode] = useState<WorkflowNode>({
    id: "event",
    name: "Create Calendar Event",
    type: "calendar.create" as WorkflowNode["type"],
    version: 1,
    config: initial,
  });
  return (
    <LocaleProvider locale="en" timeZone="Asia/Tehran">
      <CalendarEventConfigurationFields
        definition={{ schemaVersion: 1, nodes: [node], edges: [] }}
        node={node}
        editable={editable}
        validation={{ status: "valid", issues: [], runtimeChecks: [] }}
        onChange={(next) => {
          setNode(next);
          onChange(next);
        }}
      />
    </LocaleProvider>
  );
}

it("uses the account's current time zone and describes the local Calendar destination", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<Harness onChange={onChange} />);
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByRole("combobox", { name: "Time zone" })).toHaveTextContent("Asia/Tehran");
  expect(screen.getByText(/Creates an event in Warpdrive Calendar/)).toBeVisible();
  expect(screen.queryByRole("combobox", { name: "Account" })).toBeNull();
  await user.type(screen.getByRole("textbox", { name: "Event title" }), "Planning");
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({
      config: {
        allDay: false,
        timeZone: "Asia/Tehran",
        title: { kind: "value", value: "Planning" },
      },
    }),
  );
});

it("switches to date-only values in the event's authored time zone", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<Harness initial={timed} onChange={onChange} />);
  expect(screen.getByRole("combobox", { name: "Time zone" })).toHaveTextContent("Europe/Berlin");
  await user.click(screen.getByRole("checkbox", { name: "All day" }));
  expect(screen.queryByRole("textbox", { name: "Start time" })).toBeNull();
  expect(screen.getByText("The end date is included.")).toBeVisible();
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({
      config: {
        timeZone: "Europe/Berlin",
        allDay: true,
        startsAt: { kind: "value", value: "2026-11-10", literalType: "date" },
        endsAt: { kind: "value", value: "2026-11-10", literalType: "date" },
      },
    }),
  );
});

it("keeps a Berlin DST gap editable and leaves it invalid instead of shifting it", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(
    <Harness
      initial={{
        ...timed,
        startsAt: instant("2026-03-29T08:00:00Z"),
        endsAt: instant("2026-03-29T10:00:00Z"),
      }}
      onChange={onChange}
    />,
  );
  const time = screen.getByRole("textbox", { name: "Start time" });
  await user.clear(time);
  await user.type(time, "02:30");
  await user.tab();
  expect(screen.getByRole("alert")).toHaveTextContent("This local time does not exist");
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({
      config: expect.objectContaining({
        startsAt: { kind: "value", literalType: "instant", value: "2026-03-29T02:30" },
      }),
    }),
  );
});

it("shows the authored zone in a read-only published inspector without editable schedule controls", () => {
  const onChange = vi.fn();
  render(<Harness initial={timed} editable={false} onChange={onChange} />);
  expect(screen.getByRole("combobox", { name: "Time zone" })).toBeDisabled();
  expect(screen.getByRole("combobox", { name: "Time zone" })).toHaveTextContent("Europe/Berlin");
  expect(screen.getByRole("checkbox", { name: "All day" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Start date" })).toBeNull();
  expect(screen.queryByRole("textbox", { name: "Start time" })).toBeNull();
  expect(onChange).not.toHaveBeenCalled();
});

it("can repair an unavailable saved zone by explicitly choosing the current account zone", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<Harness initial={{ ...timed, timeZone: "Unknown/Zone" }} onChange={onChange} />);
  const timeZone = screen.getByRole("combobox", { name: "Time zone" });
  expect(timeZone).toHaveTextContent(/unavailable/i);
  await user.click(timeZone);
  await user.click(screen.getByRole("option", { name: "Asia/Tehran" }));
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ config: { ...timed, timeZone: "Asia/Tehran" } }),
  );
});
