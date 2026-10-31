// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { initialDefinition } from "../editorModel";
import { makeNode } from "../nodeFactory";
import { ConditionFields } from "./ConditionFields";

afterEach(cleanup);
it.each([
  ["en", "Comparison value", "Open"],
  ["fa", "مقدار مورد مقایسه", "باز"],
  ["de", "Vergleichswert", "Offen"],
] as const)(
  "shows localized deal status choices in %s without changing stored codes",
  (locale, label, status) => {
    const original = initialDefinition({
      start: "Start",
      read: "Read",
      task: "Task",
      subject: "Call",
    });
    const node = makeNode(original, "condition", "check", "Condition", "Call");
    const definition = {
      ...original,
      nodes: [...original.nodes, node],
      edges: [...original.edges, { from: "task", to: "check", port: "next" as const }],
    };
    render(
      <LocaleProvider locale={locale}>
        <ConditionFields definition={definition} node={node} editable onChange={vi.fn()} />
      </LocaleProvider>,
    );
    expect(screen.getByRole("combobox", { name: label })).toHaveTextContent(status);
    expect(node.config.right).toEqual({ kind: "value", value: "open" });
  },
);
