// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { validateNodeConfiguration } from "../configurationValidation";
import type { WorkflowDefinition, WorkflowNode } from "../schemas";
import { DelayScheduleFields } from "./DelayScheduleFields";

afterEach(cleanup);

function fixture(config: WorkflowNode["config"]) {
  const node: WorkflowNode = { id: "wait", type: "delay", version: 1, name: "Wait", config };
  const definition: WorkflowDefinition = {
    schemaVersion: 1,
    nodes: [
      { id: "start", type: "trigger.manual", version: 1, name: "Start", config: {} },
      {
        id: "read",
        type: "record.read",
        version: 1,
        name: "Read deal",
        config: {
          entity: "deal",
          recordId: { kind: "reference", nodeId: "start", path: ["recordId"] },
        },
      },
      node,
    ],
    edges: [
      { from: "start", to: "read", port: "next" },
      { from: "read", to: "wait", port: "next" },
    ],
  };
  return { definition, node };
}

function Harness({
  definition,
  node,
  change,
}: ReturnType<typeof fixture> & {
  change: (node: WorkflowNode) => void;
}) {
  const [current, setCurrent] = useState(node);
  const active = {
    ...definition,
    nodes: definition.nodes.map((entry) => (entry.id === current.id ? current : entry)),
  };
  const metadata = { status: "complete", defs: [] } as const;
  return (
    <DelayScheduleFields
      definition={active}
      node={current}
      editable
      metadata={metadata}
      validation={validateNodeConfiguration(current, { definition: active, metadata })}
      onChange={(next) => {
        change(next);
        setCurrent(next);
      }}
    />
  );
}

function mount(config: WorkflowNode["config"]) {
  const change = vi.fn<(node: WorkflowNode) => void>();
  render(
    <LocaleProvider locale="en" timeZone="Europe/Berlin">
      <Harness {...fixture(config)} change={change} />
    </LocaleProvider>,
  );
  return change;
}

it("keeps other duration units when binding and removing an upstream variable", async () => {
  const user = userEvent.setup();
  const minutes = { kind: "value", value: 1 } as const;
  const change = mount({ delayType: "DURATION", duration: { minutes } });
  expect(screen.getByRole("textbox", { name: "Minutes" })).toHaveValue("1");
  const seconds = screen.getByRole("textbox", { name: "Seconds" });
  await user.type(seconds, "2.5");
  expect(change.mock.lastCall?.[0].config).toEqual({
    delayType: "DURATION",
    duration: { minutes, seconds: { kind: "value", value: 2.5 } },
  });

  const chooser = screen.getByRole("button", { name: /^Seconds · Choose/ });
  await user.click(chooser);
  const dialog = screen.getByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: /Amount.*Read/i }));
  expect(change.mock.lastCall?.[0].config).toEqual({
    delayType: "DURATION",
    duration: { minutes, seconds: { kind: "reference", nodeId: "read", path: ["value"] } },
  });
  await waitFor(() => expect(chooser).toHaveFocus());
  expect(screen.queryByRole("textbox", { name: "Seconds" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /^Seconds · Remove/ }));
  expect(change.mock.lastCall?.[0].config).toEqual({
    delayType: "DURATION",
    duration: { minutes },
  });
});

it("authors a scheduled wall time in the account time zone and can replace it with a deal date", async () => {
  const user = userEvent.setup();
  const change = mount({
    delayType: "SCHEDULED_DATE",
    scheduledDateTime: { kind: "value", literalType: "instant", value: "2030-03-21T10:00:00.000Z" },
  });
  const time = screen.getByRole("textbox", { name: "Time" });
  expect(time).toHaveValue("11:00");
  expect(screen.getByText("Time zone: Europe/Berlin")).toBeVisible();
  expect(change).not.toHaveBeenCalled();
  fireEvent.change(time, { target: { value: "12:34" } });
  fireEvent.blur(time);
  expect(change.mock.lastCall?.[0].config).toEqual({
    delayType: "SCHEDULED_DATE",
    scheduledDateTime: { kind: "value", literalType: "instant", value: "2030-03-21T11:34:00.000Z" },
  });

  await user.click(screen.getByRole("button", { name: /^Delay until date · Choose/ }));
  const dialog = screen.getByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: /Expected close date.*Read/i }));
  expect(change.mock.lastCall?.[0].config).toEqual({
    delayType: "SCHEDULED_DATE",
    scheduledDateTime: { kind: "reference", nodeId: "read", path: ["expectedCloseDate"] },
  });
  expect(screen.getByText(/resumes at midnight UTC/)).toBeVisible();
});
