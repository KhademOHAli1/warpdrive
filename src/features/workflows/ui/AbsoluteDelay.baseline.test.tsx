// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { validateNodeConfiguration } from "../configurationValidation";
import { copyWorkflowDefinition } from "../copyDefinition";
import { delayResumeAt } from "../delay";
import copyDe from "../messages/workflows.de.json";
import copy from "../messages/workflows.en.json";
import { executableNode } from "../readiness";
import { actionRegistry } from "../registry";
import { definitionSchema, type WorkflowDefinition, type WorkflowNode } from "../schemas";
import { DelayFields } from "./DelayFields";
import { NodeInspector } from "./NodeInspector";
import { NodeSummary } from "./NodeSummary";
import { WaitTimestamp } from "./WaitTimestamp";

afterEach(cleanup);
const instant = "2030-03-20T12:34:56.123Z";
const value = (raw: string | number | boolean | null) => ({ kind: "value" as const, value: raw });
const until = (raw: string): WorkflowNode["config"] => ({
  until: { kind: "value", literalType: "instant", value: raw },
});
function fixture(config: WorkflowNode["config"]) {
  const node: WorkflowNode = {
    id: "wait",
    type: "delay",
    version: 1,
    name: "Requested deadline",
    nameMode: "custom",
    config,
  };
  const definition: WorkflowDefinition = {
    schemaVersion: 1,
    nodes: [
      {
        id: "start",
        type: "trigger.manual",
        version: 1,
        name: "Manual start",
        nameMode: "custom",
        config: {},
      },
      node,
    ],
    edges: [{ from: "start", to: "wait", port: "next" }],
  };
  return { definition, node };
}
function inspector(test: ReturnType<typeof fixture>, changed: (node: WorkflowNode) => void) {
  return (
    <LocaleProvider locale="en" calendar="gregory" numberingSystem="latn" timeZone="UTC">
      <NodeInspector
        definition={test.definition}
        node={test.node}
        editable
        onChange={changed}
        onRemove={() => undefined}
      />
    </LocaleProvider>
  );
}

it("control: keeps the duration-only helper, bounds, executable legacy wire and detached copy intact", () => {
  const now = new Date("2026-11-04T10:00:00.000Z");
  for (const minutes of [1, 60, 525600]) {
    expect(delayResumeAt(value(minutes), now)).toEqual({
      ok: true,
      value: new Date(now.getTime() + minutes * 60000),
    });
  }
  for (const raw of [value(0), value(525601), value("60")]) {
    expect(delayResumeAt(raw, now)).toEqual({ ok: false, error: ERROR_IDS.WORKFLOW_INVALID });
  }
  expect(delayResumeAt({ kind: "reference", nodeId: "start", path: ["recordId"] }, now)).toEqual({
    ok: false,
    error: ERROR_IDS.WORKFLOW_NOT_READY,
  });
  const test = fixture({ minutes: value(60) });
  expect(actionRegistry.delay.config.safeParse(test.node.config).success).toBe(true);
  expect(executableNode(test.node)).toBe(true);
  expect(validateNodeConfiguration(test.node, { definition: test.definition }).status).toBe(
    "valid",
  );
  const copied = copyWorkflowDefinition(test.definition);
  expect(copied).toEqual({ ok: true, value: test.definition });
  if (copied.ok) expect(copied.value).not.toBe(test.definition);
  expect(test.node.config).toEqual({ minutes: value(60) });
  expect(now.toISOString()).toBe("2026-11-04T10:00:00.000Z");
});

it("control: emits a real minutes edit and keeps disabled duration input and supplied wire unchanged", async () => {
  const original = value(60);
  const changed = vi.fn();
  const view = render(
    <LocaleProvider locale="en">
      <DelayFields value={original} editable onChange={changed} />
    </LocaleProvider>,
  );
  const input = screen.getByRole("textbox", { name: copy.delayMinutesLabel });
  expect(input).toHaveValue("60");
  expect(changed).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: "12" } });
  expect(changed).toHaveBeenCalledExactlyOnceWith(value(12));
  changed.mockClear();
  view.rerender(
    <LocaleProvider locale="en">
      <DelayFields value={value(12)} editable={false} onChange={changed} />
    </LocaleProvider>,
  );
  const readonly = screen.getByRole("textbox", { name: copy.delayMinutesLabel });
  expect(readonly).toBeDisabled();
  await userEvent.setup().type(readonly, "7");
  expect(readonly).toHaveValue("12");
  expect(changed).not.toHaveBeenCalled();
  expect(original).toEqual(value(60));
});

it("control: formats an existing stored waiting timestamp without changing its exact instant across preferences", () => {
  const deadline = new Date(instant);
  const view = render(
    <LocaleProvider locale="en" calendar="gregory" numberingSystem="latn" timeZone="UTC">
      <WaitTimestamp value={deadline} label={copy.scheduledResume} />
    </LocaleProvider>,
  );
  expect(screen.getByText(copy.scheduledResume)).toBeVisible();
  const first = view.container.querySelector("time");
  expect(first).toHaveAttribute("datetime", instant);
  const shown = first?.textContent;
  view.rerender(
    <LocaleProvider locale="fa" calendar="persian" numberingSystem="arabext" timeZone="Asia/Tehran">
      <WaitTimestamp value={deadline} label={copy.scheduledResume} />
    </LocaleProvider>,
  );
  const localized = view.container.querySelector("time");
  expect(localized).toHaveAttribute("datetime", instant);
  expect(localized?.textContent).not.toBe(shown);
  expect(deadline.toISOString()).toBe(instant);
});

it("gap: accepts a fixed tagged whole-millisecond until through real registry, readiness and shared validation", () => {
  const test = fixture(until(instant));
  expect(definitionSchema.safeParse(test.definition).success).toBe(true);
  const before = structuredClone(test.definition);
  expect.soft(actionRegistry.delay.config.safeParse(test.node.config).success).toBe(true);
  expect.soft(executableNode(test.node)).toBe(true);
  expect
    .soft(validateNodeConfiguration(test.node, { definition: test.definition }).status)
    .toBe("valid");
  const trailingZeros = fixture(until("2030-03-20T12:34:56.123000000Z"));
  expect.soft(actionRegistry.delay.config.safeParse(trailingZeros.node.config).success).toBe(true);
  for (const config of [
    { until: value(instant) },
    { until: { kind: "value", literalType: "date", value: "2030-03-20" } },
    until("2030-03-20T12:34"),
    until("2030-03-20T12:34:56.123456789Z"),
    { ...until(instant), minutes: value(60) },
  ]) {
    expect(actionRegistry.delay.config.safeParse(config).success).toBe(false);
  }
  expect(test.definition).toEqual(before);
});

it("gap: copies reviewed incomplete or wrong-known until drafts without completing them or widening readiness", () => {
  for (const config of [
    until(""),
    { until: { kind: "value", literalType: "number", value: "-" } },
    { until: { kind: "reference", nodeId: "start", path: ["recordId"] } },
  ] as WorkflowNode["config"][]) {
    const test = fixture(config);
    const before = structuredClone(test.definition);
    const copied = copyWorkflowDefinition(test.definition);
    expect.soft(copied).toEqual({ ok: true, value: before });
    if (copied.ok) expect(copied.value).not.toBe(test.definition);
    expect(executableNode(test.node)).toBe(false);
    expect(test.definition).toEqual(before);
  }
  const mixed = fixture({ ...until(instant), minutes: value(60) });
  expect(copyWorkflowDefinition(mixed.definition)).toMatchObject({
    ok: false,
    reason: "copy-unavailable",
  });
  const known = fixture(until(instant));
  const undefinedRaw = {
    ...known.definition,
    nodes: known.definition.nodes.map((node) =>
      node.id === "wait" ? { ...node, config: { until: undefined } } : node,
    ),
  };
  expect(copyWorkflowDefinition(undefinedRaw)).toMatchObject({
    ok: false,
    reason: "copy-unavailable",
  });
});

it("gap: exposes a fixed-instant mode and the exact authored value through current inspector props", () => {
  const test = fixture(until(instant));
  const before = structuredClone(test.definition);
  const changed = vi.fn<(node: WorkflowNode) => void>();
  render(inspector(test, changed));
  const configured = within(screen.getByRole("region", { name: copy.configure }));
  expect(configured.getByRole("textbox", { name: copy.stepName })).toHaveValue(test.node.name);
  const modes = configured.queryAllByRole("combobox");
  expect
    .soft(modes.some((mode) => /fixed instant|until.*instant/i.test(mode.textContent ?? "")))
    .toBe(true);
  const field = configured.queryByDisplayValue(instant);
  expect.soft(field).toBeInTheDocument();
  expect.soft(field).toHaveAccessibleName();
  expect(changed).not.toHaveBeenCalled();
  expect(test.definition).toEqual(before);
});

it("gap: summarizes an absolute instant with localized time and an accessible exact requested value", () => {
  const test = fixture(until(instant));
  const view = render(
    <LocaleProvider locale="de" calendar="gregory" numberingSystem="latn" timeZone="Europe/Berlin">
      <NodeSummary node={test.node} definition={test.definition} />
    </LocaleProvider>,
  );
  const localTime = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(instant));
  expect.soft(view.container).toHaveTextContent(localTime);
  const exactText = (view.container.textContent ?? "").includes(instant);
  const exactLabel = within(view.container).queryByLabelText(instant, { exact: false }) !== null;
  expect.soft(exactText || exactLabel).toBe(true);
  expect.soft(view.container).not.toHaveTextContent(copyDe.setupRequired);
  expect(test.node.config).toEqual(until(instant));
});

it("gap: retains invalid until raw text and exposes associated instant feedback on the actual field path", () => {
  const raw = "2030-03-20T12:";
  const test = fixture(until(raw));
  const before = structuredClone(test.definition);
  expect(definitionSchema.safeParse(test.definition).success).toBe(true);
  const changed = vi.fn<(node: WorkflowNode) => void>();
  render(inspector(test, changed));
  const configured = within(screen.getByRole("region", { name: copy.configure }));
  const field = configured.queryByDisplayValue(raw);
  expect.soft(field).toHaveValue(raw);
  expect.soft(field).toHaveAccessibleName();
  expect.soft(field).toHaveAttribute("aria-invalid", "true");
  expect.soft(field).toHaveAccessibleDescription(/valid|offset|instant|ISO|date|time/i);
  const validation = validateNodeConfiguration(test.node, { definition: test.definition });
  expect
    .soft(validation.issues)
    .toContainEqual(expect.objectContaining({ path: ["until"], code: "literal_instant_invalid" }));
  expect(changed).not.toHaveBeenCalled();
  expect(test.definition).toEqual(before);
});
