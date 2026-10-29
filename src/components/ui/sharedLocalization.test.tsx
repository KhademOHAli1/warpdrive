// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { ColorPicker } from "./ColorPicker";
import { Combobox } from "./Combobox";
import { Dialog, DialogContent, DialogTitle } from "./dialog";
import { MultiCombobox } from "./MultiCombobox";
import { TimePicker } from "./TimePicker";

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  global.ResizeObserver = class {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  };
});
afterEach(cleanup);

describe("shared Persian UI controls", () => {
  it("announces the dialog close action in Persian and keeps it functional", () => {
    const onOpenChange = vi.fn();
    render(
      <LocaleProvider locale="fa">
        <Dialog open onOpenChange={onOpenChange}>
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>ویرایش مخاطب</DialogTitle>
          </DialogContent>
        </Dialog>
      </LocaleProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "بستن" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("localizes combobox defaults and search empty states", () => {
    render(
      <LocaleProvider locale="fa">
        <Combobox value="" onChange={vi.fn()} options={[]} ariaLabel="مسئول" />
      </LocaleProvider>,
    );
    expect(screen.getByRole("button", { name: "مسئول" })).toHaveTextContent("انتخاب کنید");
    fireEvent.click(screen.getByRole("button", { name: "مسئول" }));
    expect(screen.getByPlaceholderText("جست‌وجو...")).toBeTruthy();
    expect(screen.getByText("موردی پیدا نشد.")).toBeTruthy();
  });

  it("announces removal of a selected person in Persian", () => {
    const onChange = vi.fn();
    render(
      <LocaleProvider locale="fa">
        <MultiCombobox
          values={["ali"]}
          onChange={onChange}
          options={[{ value: "ali", label: "علی" }]}
          ariaLabel="شرکت‌کنندگان"
        />
      </LocaleProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "حذف علی" }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("supports Persian time input while emitting the existing HH:mm value", () => {
    const onChange = vi.fn();
    render(
      <LocaleProvider locale="fa">
        <TimePicker value="14:30" onChange={onChange} ariaLabel="زمان شروع" />
      </LocaleProvider>,
    );
    const input = screen.getByLabelText("زمان شروع");
    expect(input).toHaveValue("۱۴:۳۰");
    fireEvent.change(input, { target: { value: "۹۳۰" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith("09:30");
    expect(input).toHaveValue("۰۹:۳۰");
  });

  it("localizes color choices and validation instructions", () => {
    render(
      <LocaleProvider locale="fa">
        <ColorPicker value="#000000" onChange={vi.fn()} ariaLabel="رنگ برچسب" />
      </LocaleProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "رنگ برچسب" }));
    expect(screen.getByRole("button", { name: "سیاه" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("رنگ دلخواه (کد هگز)"), { target: { value: "bad" } });
    fireEvent.click(screen.getByRole("button", { name: "اعمال رنگ" }));
    expect(screen.getByRole("alert")).toHaveTextContent("کد رنگ هگزادسیمال ۶ رقمی");
  });
});
