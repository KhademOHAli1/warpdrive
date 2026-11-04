// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { CUSTOM_FIELD_TYPES } from "@/constants/customFieldTypes";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { CustomFieldDef } from "@/types/customFields";
import {
  type WorkflowCustomReference,
  WorkflowCustomValueControl,
} from "./WorkflowCustomValueControl";

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
});
afterEach(cleanup);

const firstId = "5dc59eb9-9b65-4da6-b7d1-dfbbe21f99e7";
const secondId = "0d54b7e5-5ea0-4149-8006-159a2bb792ec";
const field = (overrides: Partial<CustomFieldDef> = {}): CustomFieldDef => ({
  id: "cf-field",
  targetEntity: "activity",
  type: "text",
  name: "Field",
  key: "field",
  options: [
    { id: "a", label: "Active" },
    { id: "b", label: "Second" },
    { id: "retired", label: "Retired", archived: true },
  ],
  isRequired: false,
  isImportant: false,
  showInAddForm: false,
  order: 0,
  archivedAt: null,
  ...overrides,
});
const lookup = (overrides: Partial<WorkflowCustomReference> = {}): WorkflowCustomReference => ({
  status: "ready",
  options: [
    { id: firstId, label: "Visible choice" },
    { id: secondId, label: "Earlier choice" },
  ],
  search: "",
  onSearch: vi.fn(),
  nextCursor: null,
  ...overrides,
});

const initialValues: Record<CustomFieldDef["type"], unknown> = {
  text: "Before",
  large_text: "Before\nAnother line",
  autocomplete: "Before",
  phone: "+49 30 1234",
  numeric: 0,
  monetary: 0,
  single_option: "b",
  multi_option: ["b"],
  user: secondId,
  person: secondId,
  org: secondId,
  date: "2026-06-12",
  time: "09:00",
  date_range: { start: "2026-06-12", end: "2026-06-25" },
  time_range: { start: "09:00", end: "17:00" },
  address: { city: "Berlin", country: "DE", lat: 0, lng: 13.4 },
};

function Controlled({ def, changed }: { def: CustomFieldDef; changed: (value: unknown) => void }) {
  const [value, setValue] = useState(initialValues[def.type]);
  return (
    <WorkflowCustomValueControl
      def={def}
      value={value}
      editable
      reference={lookup()}
      onChange={(next) => {
        changed(next);
        setValue(next);
      }}
    />
  );
}

it.each(CUSTOM_FIELD_TYPES)(
  "edits %s with its canonical value shape and clears to omission",
  async (type) => {
    const changed = vi.fn();
    render(<Controlled def={field({ type })} changed={changed} />);
    if (type === "single_option" || type === "user" || type === "person" || type === "org") {
      fireEvent.click(screen.getByRole("combobox", { name: "Field" }));
      fireEvent.click(
        screen.getByRole("option", {
          name: type === "single_option" ? "Active" : "Visible choice",
        }),
      );
      expect(changed).toHaveBeenLastCalledWith(type === "single_option" ? "a" : firstId);
    } else if (type === "multi_option") {
      fireEvent.click(screen.getByRole("checkbox", { name: "Active" }));
      expect(changed).toHaveBeenLastCalledWith(["b", "a"]);
      expect(screen.queryByRole("checkbox", { name: "Retired" })).not.toBeInTheDocument();
    } else if (type === "date" || type === "date_range") {
      fireEvent.click(
        screen.getByRole("button", { name: type === "date" ? "Field" : "Field: start" }),
      );
      fireEvent.click(await screen.findByText("15"));
      expect(changed).toHaveBeenLastCalledWith(
        type === "date" ? "2026-06-15" : { start: "2026-06-15", end: "2026-06-25" },
      );
    } else if (type === "address") {
      fireEvent.change(screen.getByLabelText("Field: Latitude"), { target: { value: "52.5" } });
      expect(changed).toHaveBeenLastCalledWith({
        city: "Berlin",
        country: "DE",
        lat: 52.5,
        lng: 13.4,
      });
      expect(initialValues.address).toEqual({ city: "Berlin", country: "DE", lat: 0, lng: 13.4 });
    } else {
      const input = screen.getByRole("textbox", {
        name: type === "time_range" ? "Field: start" : "Field",
      });
      const next =
        type === "numeric"
          ? "-2.5"
          : type === "monetary"
            ? "-12.50"
            : type === "time" || type === "time_range"
              ? "10:30"
              : type === "phone"
                ? "+49 30 9876"
                : "After";
      fireEvent.change(input, { target: { value: next } });
      const expected =
        type === "numeric"
          ? -2.5
          : type === "monetary"
            ? -12.5
            : type === "time_range"
              ? { start: "10:30", end: "17:00" }
              : next;
      expect(changed).toHaveBeenLastCalledWith(expected);
      if (type === "text" || type === "autocomplete")
        expect(input).toHaveAttribute("maxlength", "255");
      if (type === "large_text") expect(input).toHaveAttribute("maxlength", "65535");
    }
    fireEvent.click(screen.getByRole("button", { name: "Clear value" }));
    expect(changed).toHaveBeenLastCalledWith(undefined);
    expect(screen.getByText("Not set")).toBeInTheDocument();
  },
);

it("distinguishes omission and null without making important optional fields required", () => {
  const changed = vi.fn();
  const def = field({ isImportant: true });
  const { rerender } = render(
    <WorkflowCustomValueControl def={def} value={undefined} onChange={changed} editable />,
  );
  expect(screen.getByText("Not set")).toBeInTheDocument();
  expect(screen.queryByText(/\(required\)/)).not.toBeInTheDocument();
  rerender(<WorkflowCustomValueControl def={def} value="Authored" onChange={changed} editable />);
  fireEvent.change(screen.getByRole("textbox", { name: "Field" }), { target: { value: "" } });
  expect(changed).toHaveBeenLastCalledWith("");
  changed.mockClear();
  rerender(<WorkflowCustomValueControl def={def} value="" onChange={changed} editable />);
  expect(screen.queryByText("Not set")).not.toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  rerender(<WorkflowCustomValueControl def={def} value={null} onChange={changed} editable />);
  expect(screen.getByRole("alert")).toHaveTextContent("Null is not allowed");
  expect(screen.queryByText("Not set")).not.toBeInTheDocument();
  expect(changed).not.toHaveBeenCalled();
  rerender(
    <WorkflowCustomValueControl
      def={field({ isRequired: true })}
      value={undefined}
      onChange={changed}
      editable
    />,
  );
  expect(screen.getByText(/\(required\)/)).toBeInTheDocument();
});

it("keeps malformed numeric, excessive money precision and invalid time drafts instead of stale values", () => {
  const changed = vi.fn();
  const { rerender } = render(
    <WorkflowCustomValueControl
      def={field({ type: "monetary" })}
      value={0}
      onChange={changed}
      editable
    />,
  );
  expect(screen.getByRole("textbox", { name: "Field" })).toHaveValue("0");
  fireEvent.change(screen.getByRole("textbox", { name: "Field" }), { target: { value: "1.235" } });
  expect(changed).toHaveBeenLastCalledWith("1.235");
  fireEvent.change(screen.getByRole("textbox", { name: "Field" }), {
    target: { value: "1.00000000000000001" },
  });
  expect(changed).toHaveBeenLastCalledWith("1.00000000000000001");
  rerender(
    <WorkflowCustomValueControl
      def={field({ type: "numeric" })}
      value={7}
      onChange={changed}
      editable
    />,
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Field" }), { target: { value: "1,23" } });
  expect(changed).toHaveBeenLastCalledWith("1,23");
  rerender(
    <WorkflowCustomValueControl
      def={field({ type: "time" })}
      value="09:00"
      onChange={changed}
      editable
    />,
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Field" }), { target: { value: "99:99" } });
  expect(changed).toHaveBeenLastCalledWith("99:99");
});

it("disables the fieldset and guards callbacks after edit authority is removed", () => {
  const changed = vi.fn();
  render(
    <WorkflowCustomValueControl
      def={field({ type: "address" })}
      value={initialValues.address}
      onChange={changed}
      editable={false}
    />,
  );
  expect(screen.getByRole("group", { name: "Field" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Field: City"), { target: { value: "Changed" } });
  fireEvent.click(screen.getByRole("button", { name: "Clear value" }));
  expect(changed).not.toHaveBeenCalled();
});

it("uses only supplied ready reference choices and preserves bounded search, continuation and retry callbacks", () => {
  const changed = vi.fn();
  const search = vi.fn();
  const more = vi.fn();
  const retry = vi.fn();
  const def = field({ type: "person" });
  const props = { def, value: secondId, onChange: changed, editable: true };
  const { rerender } = render(<WorkflowCustomValueControl {...props} />);
  expect(screen.getByRole("combobox", { name: "Field" })).toBeDisabled();
  for (const status of ["loading", "error", "denied"] as const) {
    rerender(
      <WorkflowCustomValueControl
        {...props}
        reference={lookup({ status, onSearch: search, retry })}
      />,
    );
    expect(screen.getByRole("combobox", { name: "Field" })).toBeDisabled();
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
  }
  rerender(
    <WorkflowCustomValueControl
      {...props}
      reference={lookup({ status: "error", search: "Ali", onSearch: search, retry })}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(retry).toHaveBeenCalledOnce();
  expect(changed).not.toHaveBeenCalled();
  rerender(
    <WorkflowCustomValueControl
      {...props}
      reference={lookup({ search: "Ali", onSearch: search, nextCursor: "next-page", onMore: more })}
    />,
  );
  fireEvent.change(screen.getByLabelText("Search choices"), { target: { value: "Ada" } });
  expect(search).toHaveBeenCalledWith("Ada");
  fireEvent.click(screen.getByRole("button", { name: "Load more choices" }));
  expect(more).toHaveBeenCalledOnce();
  expect(changed).not.toHaveBeenCalled();
});

it("associates current errors with the value group and never stringifies false or objects", () => {
  const changed = vi.fn();
  const { rerender } = render(
    <WorkflowCustomValueControl
      def={field()}
      value={{ private: "opaque" }}
      error="Check this field"
      onChange={changed}
      editable
    />,
  );
  const group = screen.getByRole("group", { name: "Field" });
  const alert = screen.getByRole("alert");
  expect(group).toHaveAttribute("aria-invalid", "true");
  expect(group).toHaveAttribute("aria-describedby", alert.id);
  expect(screen.getByRole("textbox", { name: "Field" })).toHaveValue("");
  expect(screen.queryByText(/\[object Object\]|opaque/)).not.toBeInTheDocument();
  rerender(<WorkflowCustomValueControl def={field()} value={false} onChange={changed} editable />);
  expect(screen.getByRole("textbox", { name: "Field" })).toHaveValue("");
  expect(screen.queryByText("Not set")).not.toBeInTheDocument();
  expect(changed).not.toHaveBeenCalled();
});

it.each([
  { locale: "en", raw: "-1,234.50" },
  { locale: "de", raw: "-1.234,50" },
  { locale: "fa", raw: "−۱٬۲۳۴٫۵۰" },
] as const)(
  "normalizes authored $locale monetary input without rounding or changing its type",
  ({ locale, raw }) => {
    const changed = vi.fn();
    render(
      <LocaleProvider locale={locale}>
        <WorkflowCustomValueControl
          def={field({ type: "monetary", name: "Budget" })}
          value={undefined}
          onChange={changed}
          editable
        />
      </LocaleProvider>,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Budget" }), { target: { value: raw } });
    expect(changed).toHaveBeenLastCalledWith(-1234.5);
    expect(typeof changed.mock.calls.at(-1)?.[0]).toBe("number");
  },
);
