// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeAll, expect, it } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import german from "../messages/workflows.de.json";
import english from "../messages/workflows.en.json";
import persian from "../messages/workflows.fa.json";
import type { WorkflowNode } from "../schemas";
import { ConditionFields } from "./ConditionFields";
import { fixture, flat, grouped, prepareGroupDom } from "./conditionGroups.TestHelpers";

beforeAll(prepareGroupDom);
afterEach(cleanup);
const copies = { en: english, de: german, fa: persian };
function Editor({
  locale,
  groupedConfig = false,
}: {
  locale: "en" | "de" | "fa";
  groupedConfig?: boolean;
}) {
  const initial = fixture(groupedConfig ? grouped() : flat());
  initial.node.type = "filter";
  initial.definition.nodes = initial.definition.nodes.filter((node) => node.id !== "otherwise");
  initial.definition.edges = initial.definition.edges
    .filter((edge) => edge.port !== "false")
    .map((edge) => (edge.from === "check" ? { ...edge, port: "next" } : edge));
  const [node, setNode] = useState<WorkflowNode>(initial.node);
  const definition = {
    ...initial.definition,
    nodes: initial.definition.nodes.map((entry) => (entry.id === node.id ? node : entry)),
  };
  return (
    <LocaleProvider locale={locale} detectBrowserContext={false}>
      <ConditionFields
        definition={definition}
        node={node}
        editable
        onChange={setNode}
        metadata={{ status: "complete", defs: [] }}
      />
      <output data-testid="filter-config">{JSON.stringify(node.config)}</output>
    </LocaleProvider>
  );
}
it.each(["en", "de", "fa"] as const)(
  "explains successful filter termination in both %s editors",
  (locale) => {
    const copy = copies[locale];
    const mounted = render(<Editor locale={locale} />);
    expect(screen.getByText(copy.filterActionHint)).toBeInTheDocument();
    expect(screen.queryByText(copy.conditionActionHint)).not.toBeInTheDocument();
    mounted.unmount();
    render(<Editor locale={locale} groupedConfig />);
    expect(screen.getByText(copy.filterActionHint)).toBeInTheDocument();
    expect(screen.queryByText(copy.conditionOtherwise)).not.toBeInTheDocument();
  },
);
it("preserves the filter node while editing and converting its predicates", async () => {
  render(<Editor locale="en" />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: english.conditionOperator }));
  await user.click(screen.getByRole("option", { name: english.notEquals }));
  expect(JSON.parse(screen.getByTestId("filter-config").textContent ?? "{}").operator).toBe(
    "notEquals",
  );
  await user.click(screen.getByRole("button", { name: english.conditionConvert }));
  expect(screen.getByRole("combobox", { name: english.conditionMatch })).toHaveTextContent(
    english.conditionAll,
  );
  expect(screen.getByText(english.filterActionHint)).toBeInTheDocument();
  expect(screen.queryByText(english.conditionOtherwise)).not.toBeInTheDocument();
  const config = JSON.parse(screen.getByTestId("filter-config").textContent ?? "{}");
  expect(config.expression.children[0].operator).toBe("notEquals");
});
