// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { TimePicker } from "./TimePicker";

afterEach(() => {
  cleanup();
});

describe("TimePicker", () => {
  it("normalizes free typing to HH:mm on blur", () => {
    const onChange = vi.fn();
    render(<TimePicker value="" onChange={onChange} ariaLabel="Start time" />);
    const input = screen.getByLabelText("Start time");
    fireEvent.change(input, { target: { value: "930" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith("09:30");
  });

  it("shows the current value", () => {
    render(<TimePicker value="14:00" onChange={vi.fn()} ariaLabel="Start time" />);
    expect(screen.getByLabelText("Start time")).toHaveValue("14:00");
  });

  it("normalizes on Enter without requiring blur", () => {
    const onChange = vi.fn();
    render(<TimePicker value="" onChange={onChange} ariaLabel="Start time" />);
    const input = screen.getByLabelText("Start time");
    fireEvent.change(input, { target: { value: "9" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith("09:00");
  });

  it("does not call onChange when the normalized value is unchanged", () => {
    const onChange = vi.fn();
    render(<TimePicker value="09:30" onChange={onChange} ariaLabel="Start time" />);
    const input = screen.getByLabelText("Start time");
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("preserves invalid input and the canonical value while exposing an error", () => {
    const onChange = vi.fn();
    render(<TimePicker value="14:00" onChange={onChange} ariaLabel="Start time" />);
    const input = screen.getByLabelText("Start time");
    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.blur(input);
    expect(input).toHaveValue("abc");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid time");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("updates the draft when the value prop changes externally", () => {
    const { rerender } = render(
      <TimePicker value="09:00" onChange={vi.fn()} ariaLabel="Start time" />,
    );
    rerender(<TimePicker value="10:15" onChange={vi.fn()} ariaLabel="Start time" />);
    expect(screen.getByLabelText("Start time")).toHaveValue("10:15");
  });
});

it("keeps an uncommitted changed time across language/digit changes and normalizes it on blur", () => {
  const onChange = vi.fn();
  const field = (locale: "en" | "fa", numberingSystem: "latn" | "arabext") => (
    <LocaleProvider locale={locale} numberingSystem={numberingSystem}>
      <TimePicker value="09:00" onChange={onChange} ariaLabel="Start time" />
    </LocaleProvider>
  );
  const view = render(field("en", "latn"));
  const input = screen.getByLabelText("Start time");
  fireEvent.change(input, { target: { value: "10:30" } });
  view.rerender(field("fa", "arabext"));
  expect(input).toHaveValue("10:30");
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.blur(input);
  expect(onChange).toHaveBeenLastCalledWith("10:30");
  expect(input).toHaveValue("۱۰:۳۰");
});

it("reformats a pristine canonical value when language or numbering display changes", () => {
  const field = (locale: "en" | "fa", numberingSystem: "latn" | "arabext") => (
    <LocaleProvider locale={locale} numberingSystem={numberingSystem}>
      <TimePicker value="09:00" onChange={vi.fn()} ariaLabel="Start time" />
    </LocaleProvider>
  );
  const view = render(field("en", "latn"));
  view.rerender(field("fa", "arabext"));
  expect(screen.getByLabelText("Start time")).toHaveValue("۰۹:۰۰");
  view.rerender(field("fa", "latn"));
  expect(screen.getByLabelText("Start time")).toHaveValue("09:00");
});

it("preserves an invalid raw draft across preferences, then validates it in Farsi", () => {
  const onChange = vi.fn();
  const field = (locale: "en" | "fa") => (
    <LocaleProvider locale={locale}>
      <TimePicker value="09:00" onChange={onChange} ariaLabel="Start time" />
    </LocaleProvider>
  );
  const view = render(field("en"));
  const input = screen.getByLabelText("Start time");
  fireEvent.change(input, { target: { value: "25:99" } });
  view.rerender(field("fa"));
  expect(input).toHaveValue("25:99");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  fireEvent.blur(input);
  expect(input).toHaveValue("25:99");
  expect(input).toBeInvalid();
  expect(screen.getByRole("alert")).toHaveTextContent("ساعت معتبری با قالب ساعت:دقیقه وارد کنید");
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: "۱۰:۳۰" } });
  fireEvent.blur(input);
  expect(onChange).toHaveBeenLastCalledWith("10:30");
  expect(input).toBeValid();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("preserves Persian raw digits when only numbering preferences change", () => {
  const onChange = vi.fn();
  const field = (numberingSystem: "latn" | "arabext") => (
    <LocaleProvider locale="fa" numberingSystem={numberingSystem}>
      <TimePicker value="09:00" onChange={onChange} ariaLabel="Start time" />
    </LocaleProvider>
  );
  const view = render(field("arabext"));
  const input = screen.getByLabelText("Start time");
  fireEvent.change(input, { target: { value: "۱۰:۳۰" } });
  view.rerender(field("latn"));
  expect(input).toHaveValue("۱۰:۳۰");
  fireEvent.blur(input);
  expect(input).toHaveValue("10:30");
  expect(onChange).toHaveBeenLastCalledWith("10:30");
});

it("accepts an authoritative canonical change while an invalid draft is present", () => {
  const onChange = vi.fn();
  const field = (value: string) => (
    <TimePicker value={value} onChange={onChange} ariaLabel="Start time" />
  );
  const view = render(field("09:00"));
  const input = screen.getByLabelText("Start time");
  fireEvent.change(input, { target: { value: "99:99" } });
  fireEvent.blur(input);
  expect(input).toBeInvalid();
  view.rerender(field("10:15"));
  expect(input).toHaveValue("10:15");
  expect(input).toBeValid();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(onChange).not.toHaveBeenCalled();
});

it("blocks form submission and exposes the associated error for an invalid raw time", () => {
  const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
  const onChange = vi.fn();
  render(
    <form onSubmit={onSubmit}>
      <TimePicker value="09:00" onChange={onChange} ariaLabel="Start time" />
      <button type="submit">Save</button>
    </form>,
  );
  const input = screen.getByLabelText("Start time");
  fireEvent.change(input, { target: { value: "25:99" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  const error = screen.getByRole("alert");
  expect(input).toHaveAttribute("aria-describedby", error.id);
  expect(input).toHaveValue("25:99");
  expect(onSubmit).not.toHaveBeenCalled();
  expect(onChange).not.toHaveBeenCalled();
});

it("prevents Enter from submitting an invalid time and allows an intentional clear", () => {
  const onChange = vi.fn();
  render(<TimePicker value="09:00" onChange={onChange} ariaLabel="Start time" />);
  const input = screen.getByLabelText("Start time");
  fireEvent.change(input, { target: { value: "99:99" } });
  expect(fireEvent.keyDown(input, { key: "Enter" })).toBe(false);
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: "" } });
  fireEvent.blur(input);
  expect(input).toBeValid();
  expect(onChange).toHaveBeenLastCalledWith("");
});

it("relocalizes an existing validation error without changing the invalid raw input", () => {
  const onChange = vi.fn();
  const field = (locale: "en" | "fa") => (
    <LocaleProvider locale={locale}>
      <TimePicker value="09:00" onChange={onChange} ariaLabel="Start time" />
    </LocaleProvider>
  );
  const view = render(field("en"));
  const input = screen.getByLabelText("Start time");
  fireEvent.change(input, { target: { value: "99:99" } });
  fireEvent.blur(input);
  expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid time");
  view.rerender(field("fa"));
  expect(input).toHaveValue("99:99");
  expect(screen.getByRole("alert")).toHaveTextContent("ساعت معتبری با قالب ساعت:دقیقه وارد کنید");
  expect(input).toHaveProperty("validationMessage", "ساعت معتبری با قالب ساعت:دقیقه وارد کنید.");
  expect(onChange).not.toHaveBeenCalled();
});
