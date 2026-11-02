// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { actionRegistry } from "../registry";
import type { Binding, WorkflowDefinition, WorkflowNode } from "../schemas";
import { NodeInspector } from "./NodeInspector";

afterEach(cleanup);

function Harness({
  locale,
  editable,
  onChange,
  minutes = { kind: "value", value: 5 },
}: {
  locale: "en" | "fa" | "de";
  editable: boolean;
  onChange: (node: WorkflowNode) => void;
  minutes?: Binding;
}) {
  const [node, setNode] = useState<WorkflowNode>({
    id: "wait",
    type: "delay",
    version: 1,
    name: "Wait",
    config: { minutes },
  });
  const definition: WorkflowDefinition = {
    schemaVersion: 1,
    nodes: [{ id: "start", type: "trigger.manual", version: 1, name: "Start", config: {} }, node],
    edges: [{ from: "start", to: "wait", port: "next" }],
  };
  return (
    <LocaleProvider locale={locale}>
      <NodeInspector
        definition={definition}
        node={node}
        editable={editable}
        onChange={(next) => {
          onChange(next);
          setNode(next);
        }}
        onRemove={vi.fn()}
      />
    </LocaleProvider>
  );
}

function renderInspector(locale: "en" | "fa" | "de" = "en", editable = true, minutes?: Binding) {
  const onChange = vi.fn<(node: WorkflowNode) => void>();
  render(<Harness locale={locale} editable={editable} minutes={minutes} onChange={onChange} />);
  return onChange;
}

it.each([
  ["en", "Wait duration (minutes)", /1 to 525,600/],
  ["fa", "مدت انتظار (دقیقه)", /۱ تا ۵۲۵٬۶۰۰/],
  ["de", "Wartezeit (Minuten)", /1 bis 525\.600/],
] as const)("labels the literal duration in %s", (locale, label, bounds) => {
  renderInspector(locale);
  const input = screen.getByLabelText(label);
  expect(input).toHaveValue("5");
  expect(input).toHaveAccessibleDescription(bounds);
});

it.each([
  [
    "en",
    "Wait duration (minutes)",
    "Mapped durations are not available. Enter a fixed number of minutes.",
  ],
  [
    "fa",
    "مدت انتظار (دقیقه)",
    "مدت انتظارِ برگرفته از گام‌های دیگر پشتیبانی نمی‌شود. تعداد دقیقه‌ها را به‌صورت ثابت وارد کنید.",
  ],
  [
    "de",
    "Wartezeit (Minuten)",
    "Die Wartezeit kann noch nicht aus einem anderen Schritt übernommen werden. Geben Sie eine feste Anzahl von Minuten ein.",
  ],
] as const)(
  "explains unsupported mapping in %s without changing it on mount",
  (locale, label, message) => {
    const binding: Binding = { kind: "reference", nodeId: "read", path: ["value"] };
    const changed = renderInspector(locale, true, binding);
    expect(screen.getByText(message)).toBeVisible();
    expect(screen.getByLabelText(label)).toHaveAccessibleDescription(
      new RegExp(message.replaceAll(".", "\\.")),
    );
    expect(changed).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(label), { target: { value: "60" } });
    expect(changed).toHaveBeenLastCalledWith(
      expect.objectContaining({ config: { minutes: { kind: "value", value: 60 } } }),
    );
    expect(screen.queryByText(message)).not.toBeInTheDocument();
  },
);

it("preserves a mapped duration in a read-only inspector", async () => {
  const changed = renderInspector("en", false, {
    kind: "reference",
    nodeId: "read",
    path: ["value"],
  });
  const input = screen.getByLabelText("Wait duration (minutes)");
  expect(
    screen.getByText("Mapped durations are not available. Enter a fixed number of minutes."),
  ).toBeVisible();
  expect(input).toBeDisabled();
  await userEvent.setup().type(input, "60");
  expect(changed).not.toHaveBeenCalled();
});

it.each(["123", "۱۲۳", "١٢٣"])("accepts whole minutes entered as %s", async (value) => {
  const changed = renderInspector();
  const input = screen.getByLabelText("Wait duration (minutes)");
  const user = userEvent.setup();
  await user.clear(input);
  await user.type(input, value);
  expect(changed).toHaveBeenLastCalledWith(
    expect.objectContaining({ config: { minutes: { kind: "value", value: 123 } } }),
  );
  expect(input).toHaveValue("123");
  expect(input).toHaveAttribute("aria-invalid", "false");
});

it.each(["1.5", "۱٫۵", "1,5", "", "0", "-1", "525601", "1e2"])(
  "preserves invalid intermediate duration %j without coercion",
  (value) => {
    const changed = renderInspector();
    const input = screen.getByLabelText("Wait duration (minutes)");
    fireEvent.change(input, { target: { value } });
    const config = { minutes: { kind: "value", value } };
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ config }));
    expect(input).toHaveValue(value);
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(actionRegistry.delay.config.safeParse(config).success).toBe(false);
  },
);

it("disables the duration in a read-only inspector", async () => {
  const changed = renderInspector("en", false);
  const input = screen.getByLabelText("Wait duration (minutes)");
  expect(input).toBeDisabled();
  await userEvent.setup().type(input, "60");
  expect(input).toHaveValue("5");
  expect(changed).not.toHaveBeenCalled();
});
