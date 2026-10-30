// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { dealRowsToDefinition } from "@/features/deals/dealFilterRows";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { Locale } from "@/features/i18n/registry";
import { ConditionRowsBuilder } from "./ConditionRowsBuilder";
import { ConditionValue } from "./ConditionValue";
import type { RowValue } from "./rowValue";

afterEach(cleanup);
function Filter({
  locale,
  initial = "",
  save,
}: {
  locale: Locale;
  initial?: string;
  save: (value: unknown) => void;
}) {
  const [value, setValue] = useState<RowValue>(initial);
  return (
    <LocaleProvider locale={locale}>
      <ConditionValue
        input={{ kind: "number" }}
        ariaLabel="Amount"
        value={value}
        onChange={setValue}
      />
      <button
        type="button"
        onClick={() =>
          save(dealRowsToDefinition([{ field: "value", op: "gt", value }], "and", locale))
        }
      >
        Apply
      </button>
    </LocaleProvider>
  );
}
it("shows a stored canonical decimal in German without changing its filter value", () => {
  const save = vi.fn();
  render(<Filter locale="de" initial="1.234" save={save} />);
  expect(screen.getByLabelText("Amount")).toHaveValue("1,234");
  fireEvent.click(screen.getByText("Apply"));
  expect(save).toHaveBeenCalledWith({
    combinator: "and",
    conditions: [{ field: "value", op: "gt", value: "1.234" }],
  });
});
it("preserves grouped and unfinished drafts and compiles a German decimal exactly once", () => {
  const save = vi.fn();
  render(<Filter locale="de" save={save} />);
  const field = screen.getByLabelText("Amount");
  fireEvent.change(field, { target: { value: "1," } });
  expect(field).toHaveValue("1,");
  fireEvent.change(field, { target: { value: "1.234,56" } });
  expect(field).toHaveValue("1.234,56");
  fireEvent.click(screen.getByText("Apply"));
  expect(save.mock.lastCall?.[0].conditions[0].value).toBe("1234.56");
  fireEvent.change(field, { target: { value: "1,234" } });
  fireEvent.click(screen.getByText("Apply"));
  expect(save.mock.lastCall?.[0].conditions[0].value).toBe("1.234");
});
it("keeps an active German draft's meaning after the interface switches to English", () => {
  const save = vi.fn();
  const view = render(<Filter locale="de" save={save} />);
  const field = screen.getByLabelText("Amount");
  fireEvent.change(field, { target: { value: "1,234" } });
  view.rerender(<Filter locale="en" save={save} />);
  expect(field).toHaveValue("1,234");
  fireEvent.click(screen.getByText("Apply"));
  expect(save.mock.lastCall?.[0].conditions[0].value).toBe("1.234");
});

it("emits only a canonical primitive from the shared Apply callback after a locale switch", () => {
  const onApply = vi.fn();
  const element = (locale: Locale) => (
    <LocaleProvider locale={locale}>
      <ConditionRowsBuilder
        fields={[{ field: "value", label: "Amount", ops: ["gt"], input: { kind: "number" } }]}
        opLabels={{ gt: "greater than" }}
        activeCount={0}
        appliedRows={[{ field: "value", op: "gt", value: "" }]}
        onApply={onApply}
        onClear={vi.fn()}
      />
    </LocaleProvider>
  );
  const view = render(element("de"));
  fireEvent.click(screen.getByRole("button", { name: "Filter" }));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "1,234" } });
  view.rerender(element("en"));
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  expect(onApply).toHaveBeenCalledWith([{ field: "value", op: "gt", value: "1.234" }], "and");
});

it("keeps invalid German drafts visible with an accessible error and blocks Apply until corrected", () => {
  const onApply = vi.fn();
  render(
    <LocaleProvider locale="de">
      <ConditionRowsBuilder
        fields={[{ field: "value", label: "Amount", ops: ["gt"], input: { kind: "number" } }]}
        opLabels={{ gt: "greater than" }}
        activeCount={0}
        appliedRows={[{ field: "value", op: "gt", value: "" }]}
        onApply={onApply}
        onClear={vi.fn()}
      />
    </LocaleProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Filter" }));
  const input = screen.getByRole("textbox");
  fireEvent.change(input, { target: { value: "1.23" } });
  expect(input).toHaveValue("1.23");
  expect(input).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByRole("alert")).toBeInTheDocument();
  const apply = screen.getByRole("button", { name: "Anwenden" });
  expect(apply).toBeDisabled();
  fireEvent.click(apply);
  expect(onApply).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: "1,23" } });
  fireEvent.click(apply);
  expect(onApply).toHaveBeenCalledWith([{ field: "value", op: "gt", value: "1.23" }], "and");
});
