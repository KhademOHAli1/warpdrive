// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { ConfigurationMetadata } from "../configurationTypes";
import german from "../messages/workflows.de.json";
import english from "../messages/workflows.en.json";
import persian from "../messages/workflows.fa.json";
import type { WorkflowDefinition, WorkflowNode } from "../schemas";
import { NodeInspector } from "./NodeInspector";
import { useGraphHistory } from "./useGraphHistory";

const query = vi.hoisted(() => ({
  metadata: { status: "complete", defs: [] } as ConfigurationMetadata,
  authoring: true,
}));
vi.mock("./useWorkflowConfiguration", () => ({
  useWorkflowConfiguration: () => ({
    ...query,
    busy: false,
    loadMore: undefined,
    retry: () => Promise.resolve(),
  }),
}));

const instant = "2030-03-20T12:34:56.123000000+00:00";
const duration = { minutes: { kind: "value", value: 60 } } as const;
const fixed = (raw: string): WorkflowNode["config"] => ({
  until: { kind: "value", literalType: "instant", value: raw },
});
const profiles = [
  {
    name: "English",
    locale: "en",
    calendar: "gregory",
    numberingSystem: "latn",
    timeZone: "UTC",
    copy: english,
  },
  {
    name: "German",
    locale: "de",
    calendar: "gregory",
    numberingSystem: "latn",
    timeZone: "Europe/Berlin",
    copy: german,
  },
  {
    name: "Persian calendar and digits",
    locale: "fa",
    calendar: "persian",
    numberingSystem: "arabext",
    timeZone: "Asia/Tehran",
    copy: persian,
  },
  {
    name: "Persian language Gregorian Latin display",
    locale: "fa",
    calendar: "gregory",
    numberingSystem: "latn",
    timeZone: "UTC",
    copy: persian,
  },
] as const;

function fixture(config: WorkflowNode["config"]): WorkflowDefinition {
  return {
    schemaVersion: 1,
    nodes: [
      { id: "start", type: "trigger.manual", version: 1, name: "Start", config: {} },
      { id: "wait", type: "delay", version: 1, name: "Wait", config },
    ],
    edges: [{ from: "start", to: "wait", port: "next" }],
  };
}

function HistoryInspector({
  initial,
  editable = true,
  changed,
  rendered,
}: {
  initial: WorkflowDefinition;
  editable?: boolean;
  changed: (node: WorkflowNode) => void;
  rendered: (definition: WorkflowDefinition) => void;
}) {
  const history = useGraphHistory(initial);
  const node = history.definition.nodes[1]!;
  useEffect(() => rendered(history.definition), [history.definition, rendered]);
  return (
    <>
      <NodeInspector
        workflowId="0a2e900b-20fa-4f3a-91c2-2e8936ceee29"
        definition={history.definition}
        node={node}
        editable={editable}
        onChange={(updated) => {
          changed(updated);
          history.setDefinition((current) => ({
            ...current,
            nodes: current.nodes.map((item) => (item.id === updated.id ? updated : item)),
          }));
        }}
        onRemove={() => undefined}
      />
      <button type="button" onClick={history.undo} disabled={!history.canUndo}>
        Undo
      </button>
      <button type="button" onClick={history.redo} disabled={!history.canRedo}>
        Redo
      </button>
    </>
  );
}

function mount(config: WorkflowNode["config"], editable = true) {
  const initial = fixture(config);
  const changed = vi.fn<(node: WorkflowNode) => void>();
  const rendered = vi.fn<(definition: WorkflowDefinition) => void>();
  const view = render(
    <LocaleProvider locale="en">
      <HistoryInspector
        initial={initial}
        editable={editable}
        changed={changed}
        rendered={rendered}
      />
    </LocaleProvider>,
  );
  return { ...view, initial, changed, rendered };
}

beforeEach(() => {
  query.metadata = { status: "complete", defs: [] };
  query.authoring = true;
});
afterEach(cleanup);

it.each(profiles)("authors a fixed raw instant explicitly in $name", async (profile) => {
  const initial = fixture(duration);
  const changed = vi.fn<(node: WorkflowNode) => void>();
  const rendered = vi.fn<(definition: WorkflowDefinition) => void>();
  render(
    <LocaleProvider
      locale={profile.locale}
      calendar={profile.calendar}
      numberingSystem={profile.numberingSystem}
      timeZone={profile.timeZone}
    >
      <HistoryInspector initial={initial} changed={changed} rendered={rendered} />
    </LocaleProvider>,
  );
  const user = userEvent.setup();
  expect(screen.getByRole("textbox", { name: profile.copy.delayMinutesLabel })).toHaveValue("60");
  expect(changed).not.toHaveBeenCalled();
  const mode = screen.getByRole("combobox", { name: profile.copy.delayModeLabel });
  mode.focus();
  await user.keyboard("{Enter}");
  await user.click(screen.getByRole("option", { name: profile.copy.delayModeUntil }));
  expect(mode).toHaveFocus();
  expect(changed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ config: fixed("") }));
  expect(
    screen.queryByRole("textbox", { name: profile.copy.delayMinutesLabel }),
  ).not.toBeInTheDocument();
  const input = screen.getByRole("textbox", { name: profile.copy.delayUntilLabel });
  expect(input).toHaveValue("");
  fireEvent.change(input, { target: { value: instant } });
  expect(changed.mock.lastCall?.[0].config).toEqual(fixed(instant));
  expect(rendered.mock.lastCall?.[0].nodes[1]?.config).toEqual(fixed(instant));
  expect(input).toHaveAttribute("aria-invalid", "false");
  expect(input).toHaveAccessibleDescription(/ISO|Z|UTC/);
  expect(initial.nodes[1]?.config).toBe(duration);
});

it.each(profiles)("opens an existing exact instant without converting it in $name", (profile) => {
  const initial = fixture(fixed(instant));
  const changed = vi.fn<(node: WorkflowNode) => void>();
  const rendered = vi.fn<(definition: WorkflowDefinition) => void>();
  render(
    <LocaleProvider
      locale={profile.locale}
      calendar={profile.calendar}
      numberingSystem={profile.numberingSystem}
      timeZone={profile.timeZone}
    >
      <HistoryInspector initial={initial} changed={changed} rendered={rendered} />
    </LocaleProvider>,
  );
  const input = screen.getByRole("textbox", { name: profile.copy.delayUntilLabel });
  expect(input).toHaveValue(instant);
  fireEvent.blur(input);
  expect(changed).not.toHaveBeenCalled();
  expect(rendered.mock.lastCall?.[0]).toBe(initial);
  expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
});

it("makes a whole-config mode change one history edit and restores exact prior wire with undo/redo", async () => {
  const original = fixed(instant);
  const test = mount(original);
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: english.delayModeLabel }));
  await user.click(screen.getByRole("option", { name: english.delayModeDuration }));
  expect(test.changed).toHaveBeenCalledTimes(1);
  expect(test.changed.mock.lastCall?.[0].config).toEqual({ minutes: { kind: "value", value: "" } });
  expect(screen.getByRole("textbox", { name: english.delayMinutesLabel })).toHaveValue("");
  await user.click(screen.getByRole("button", { name: "Undo" }));
  expect(test.rendered.mock.lastCall?.[0]).toBe(test.initial);
  expect(screen.getByRole("textbox", { name: english.delayUntilLabel })).toHaveValue(instant);
  expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Redo" }));
  expect(test.rendered.mock.lastCall?.[0].nodes[1]?.config).toEqual({
    minutes: { kind: "value", value: "" },
  });
  expect(test.initial.nodes[1]?.config).toBe(original);
});

it("keeps opening, blur, unchanged text and reselecting the current mode out of history", async () => {
  const test = mount(fixed(instant));
  const user = userEvent.setup();
  const input = screen.getByRole("textbox", { name: english.delayUntilLabel });
  fireEvent.change(input, { target: { value: instant } });
  fireEvent.blur(input);
  await user.click(screen.getByRole("combobox", { name: english.delayModeLabel }));
  await user.click(screen.getByRole("option", { name: english.delayModeUntil }));
  expect(test.changed).not.toHaveBeenCalled();
  expect(test.rendered.mock.lastCall?.[0]).toBe(test.initial);
  expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
});

it("retains incomplete raw edits with their instant tag and associated validation instead of completing them", () => {
  const test = mount(fixed(instant));
  const input = screen.getByRole("textbox", { name: english.delayUntilLabel });
  fireEvent.change(input, { target: { value: "2030-03-20T12:" } });
  expect(test.changed).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ config: fixed("2030-03-20T12:") }),
  );
  expect(input).toHaveValue("2030-03-20T12:");
  expect(input).toHaveAttribute("aria-invalid", "true");
  expect(input).toHaveAccessibleDescription(/valid|offset|instant|ISO/i);
});

it.each([
  { name: "civil date", raw: "2030-03-20" },
  { name: "zone-free wall time", raw: "2030-03-20T12:34:56" },
  { name: "submillisecond target", raw: "2030-03-20T12:34:56.1234Z" },
])("does not reinterpret a $name draft", ({ raw }) => {
  const test = mount(fixed(raw));
  const input = screen.getByRole("textbox", { name: english.delayUntilLabel });
  expect(input).toHaveValue(raw);
  expect(input).toHaveAttribute("aria-invalid", "true");
  expect(input).toHaveAccessibleDescription(/ISO|millisecond|offset/i);
  expect(test.changed).not.toHaveBeenCalled();
  expect(test.rendered.mock.lastCall?.[0]).toBe(test.initial);
});

it.each([
  {
    name: "wrong-known number intent",
    binding: { kind: "value", literalType: "number", value: "-" },
    shown: "-",
  },
  { name: "untagged value", binding: { kind: "value", value: instant }, shown: instant },
  {
    name: "mapped instant",
    binding: { kind: "reference", nodeId: "start", path: ["recordId"] },
    shown: "",
  },
])("retains an inert $name binding until an explicit edit", ({ binding, shown }) => {
  const config = { until: binding } as WorkflowNode["config"];
  const test = mount(config);
  const input = screen.getByRole("textbox", { name: english.delayUntilLabel });
  expect(input).toHaveValue(shown);
  expect(input).toHaveAttribute("aria-invalid", "true");
  expect(test.changed).not.toHaveBeenCalled();
  expect(test.initial.nodes[1]?.config).toBe(config);
});

it.each(["readonly archived view", "denied metadata", "authoring permission removed"])(
  "protects a %s",
  async (state) => {
    if (state === "denied metadata") query.metadata = { status: "denied" };
    if (state === "authoring permission removed") query.authoring = false;
    const test = mount(fixed(instant), state !== "readonly archived view");
    const mode = screen.getByRole("combobox", { name: english.delayModeLabel });
    const input = screen.getByRole("textbox", { name: english.delayUntilLabel });
    expect(mode).toBeDisabled();
    expect(input).toBeDisabled();
    fireEvent.change(input, { target: { value: "2030-03-21T00:00:00Z" } });
    await userEvent.setup().click(mode);
    expect(test.changed).not.toHaveBeenCalled();
    expect(test.rendered.mock.lastCall?.[0]).toBe(test.initial);
  },
);

it("reformats account display without changing raw wire, references or history", () => {
  const test = mount(fixed(instant));
  const before = test.container.querySelector("time")?.textContent;
  test.rerender(
    <LocaleProvider locale="fa" calendar="persian" numberingSystem="arabext" timeZone="Asia/Tehran">
      <HistoryInspector initial={test.initial} changed={test.changed} rendered={test.rendered} />
    </LocaleProvider>,
  );
  expect(screen.getByRole("textbox", { name: persian.delayUntilLabel })).toHaveValue(instant);
  expect(test.container.querySelector("time")?.textContent).not.toBe(before);
  expect(test.changed).not.toHaveBeenCalled();
  expect(test.rendered.mock.lastCall?.[0]).toBe(test.initial);
  expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
});

it("explains the elapsed-minute arming bound without rejecting a syntactically valid far-future draft", () => {
  const raw = "2099-03-20T12:34:56Z";
  const test = mount(fixed(raw));
  const input = screen.getByRole("textbox", { name: english.delayUntilLabel });
  expect(input).toHaveValue(raw);
  expect(input).toHaveAttribute("aria-invalid", "false");
  expect(input).toHaveAccessibleDescription(/525,?600.*elapsed.*minutes/i);
  expect(test.changed).not.toHaveBeenCalled();
});
