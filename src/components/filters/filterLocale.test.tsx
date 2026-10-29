// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { ConditionRowsBuilder } from "./ConditionRowsBuilder";

afterEach(cleanup);

it("uses Farsi filter actions and emits canonical numeric conditions from Persian input", () => {
  const onApply = vi.fn();
  render(
    <LocaleProvider locale="fa">
      <ConditionRowsBuilder
        fields={[{ field: "value", label: "ارزش", ops: ["gt"], input: { kind: "number" } }]}
        opLabels={{ gt: "greater than" }}
        activeCount={0}
        onApply={onApply}
        onClear={vi.fn()}
      />
    </LocaleProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "فیلتر" }));
  fireEvent.click(screen.getByRole("button", { name: "افزودن شرط" }));
  fireEvent.change(screen.getByLabelText("مقدار شرط ۱"), { target: { value: "۱۲۳٫۴۵" } });
  fireEvent.click(screen.getByRole("button", { name: "اعمال" }));
  expect(onApply).toHaveBeenCalledWith([{ field: "value", op: "gt", value: "123.45" }], "and");
});
