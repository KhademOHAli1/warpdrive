// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { legacyMappingTarget } from "../mappingCatalog";
import copy from "../messages/workflows.en.json";
import type { DraftValueBinding } from "../schemas";
import { prepareMappingDom } from "./mapping.TestHelpers";
import { TypedLiteralValue } from "./TypedLiteralValue";

beforeAll(prepareMappingDom);
afterEach(cleanup);
const target = legacyMappingTarget("compare", "scalar", { nullable: true });

function NativeRoundtrip({
  value,
  changed,
}: {
  value: number;
  changed: (binding: DraftValueBinding) => void;
}) {
  const [binding, setBinding] = useState<DraftValueBinding>({ kind: "value", value });
  return (
    <TypedLiteralValue
      binding={binding}
      target={target}
      label="Value"
      editable
      onChange={(next) => {
        changed(next);
        setBinding(next);
      }}
    />
  );
}
it("displays and roundtrips tiny and large native numbers without changing their meaning", () => {
  for (const value of [1e-30, 1.2345678901234567e30]) {
    const changed = vi.fn();
    const mounted = render(<NativeRoundtrip value={value} changed={changed} />);
    const shown = screen.getByRole<HTMLInputElement>("textbox", { name: "Value" }).value;
    expect(Number(shown)).toBe(value);
    expect(changed).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: "Value" }), { target: { value: "1" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Value" }), { target: { value: shown } });
    expect(changed).toHaveBeenLastCalledWith({ kind: "value", value });
    mounted.unmount();
  }
});

it.each([
  { locale: "en", raw: "1.0250" },
  { locale: "de", raw: "1,0250" },
  { locale: "fa", raw: "۱٫۰۲۵۰" },
] as const)(
  "keeps typed $locale numeric trailing zeroes while emitting the correct native value",
  async ({ locale, raw }) => {
    const changed = vi.fn();
    const user = userEvent.setup();
    render(
      <LocaleProvider locale={locale}>
        <NativeRoundtrip value={0} changed={changed} />
      </LocaleProvider>,
    );
    const input = screen.getByRole("textbox", { name: "Value" });
    await user.clear(input);
    await user.type(input, raw);
    expect(input).toHaveValue(raw);
    expect(changed).toHaveBeenLastCalledWith({ kind: "value", value: 1.025 });
    const calls = changed.mock.calls.length;
    await user.tab();
    expect(changed).toHaveBeenCalledTimes(calls);
  },
);

it("keeps incomplete numeric input tagged through blur and rerender without a text or zero fallback", () => {
  const changed = vi.fn();
  const { rerender } = render(
    <TypedLiteralValue
      binding={{ kind: "value", value: 0 }}
      target={target}
      label="Value"
      editable
      onChange={changed}
    />,
  );
  expect(screen.getByRole("textbox", { name: "Value" })).toHaveValue("0");
  for (const raw of ["-", "", "1."]) {
    fireEvent.change(screen.getByRole("textbox", { name: "Value" }), { target: { value: raw } });
    const binding: DraftValueBinding = { kind: "value", value: raw, literalType: "number" };
    expect(changed).toHaveBeenLastCalledWith(binding);
    rerender(
      <TypedLiteralValue
        binding={binding}
        target={target}
        label="Value"
        editable
        onChange={changed}
      />,
    );
    fireEvent.blur(screen.getByRole("textbox", { name: "Value" }));
    expect(screen.getByRole("textbox", { name: "Value" })).toHaveValue(raw);
    expect(changed).toHaveBeenLastCalledWith(binding);
  }
});
it.each([
  { locale: "de", raw: "-1.234,50" },
  { locale: "fa", raw: "−۱٬۲۳۴٫۵۰" },
] as const)("authors a native number at the $locale input boundary", ({ locale, raw }) => {
  const changed = vi.fn();
  render(
    <LocaleProvider locale={locale}>
      <TypedLiteralValue
        binding={{ kind: "value", value: 0 }}
        target={target}
        label="Value"
        editable
        onChange={changed}
      />
    </LocaleProvider>,
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Value" }), { target: { value: raw } });
  expect(changed).toHaveBeenCalledExactlyOnceWith({ kind: "value", value: -1234.5 });
});
it("retains invalid civil-date intent and its associated field error", () => {
  const changed = vi.fn();
  render(
    <TypedLiteralValue
      binding={{ kind: "value", value: "2030-03-20", literalType: "date" }}
      target={target}
      label="Value"
      editable
      error="Check date"
      onChange={changed}
    />,
  );
  const input = screen.getByRole("textbox", { name: "Value" });
  fireEvent.change(input, { target: { value: "2030-02-30" } });
  expect(changed).toHaveBeenLastCalledWith({
    kind: "value",
    value: "2030-02-30",
    literalType: "date",
  });
  expect(input).toHaveAttribute("aria-invalid", "true");
  const description = input.getAttribute("aria-describedby");
  expect(description).toBeTruthy();
  expect(description === null ? null : document.getElementById(description)?.textContent).toBe(
    "Check date",
  );
});
it("preserves authored instant offset and fractional precision and retains invalid offset-free edits", () => {
  const changed = vi.fn();
  render(
    <TypedLiteralValue
      binding={{ kind: "value", value: "", literalType: "instant" }}
      target={target}
      label="Value"
      editable
      onChange={changed}
    />,
  );
  const input = screen.getByRole("textbox", { name: "Value" });
  const exact = "2030-03-20T12:00:00.123456789+03:30";
  fireEvent.change(input, { target: { value: exact } });
  expect(changed).toHaveBeenLastCalledWith({ kind: "value", value: exact, literalType: "instant" });
  fireEvent.change(input, { target: { value: "2030-03-20T12:00:00" } });
  expect(changed).toHaveBeenLastCalledWith({
    kind: "value",
    value: "2030-03-20T12:00:00",
    literalType: "instant",
  });
});
it("changes literal intent only through an explicit type selection and emits untagged null", async () => {
  const changed = vi.fn();
  const raw = "2030-02-30";
  const mounted = render(
    <TypedLiteralValue
      binding={{ kind: "value", value: raw, literalType: "date" }}
      target={target}
      label="Value"
      editable
      onChange={changed}
    />,
  );
  expect(changed).not.toHaveBeenCalled();
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: "Value · " + copy.mappingLiteralType }));
  await user.click(screen.getByRole("option", { name: copy.mappingTypes.text }));
  expect(changed).toHaveBeenLastCalledWith({ kind: "value", value: raw });
  mounted.rerender(
    <TypedLiteralValue
      binding={{ kind: "value", value: raw }}
      target={target}
      label="Value"
      editable
      onChange={changed}
    />,
  );
  await user.click(screen.getByRole("combobox", { name: "Value · " + copy.mappingLiteralType }));
  await user.click(screen.getByRole("option", { name: copy.configurationNullValue }));
  expect(changed).toHaveBeenLastCalledWith({ kind: "value", value: null });
});
