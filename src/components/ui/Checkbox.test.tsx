// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Checkbox } from "./Checkbox";

afterEach(cleanup);

function CheckboxForm({
  onChange,
  onSubmit,
}: {
  onChange: (next: boolean) => void;
  onSubmit: React.FormEventHandler<HTMLFormElement>;
}) {
  const [checked, setChecked] = useState<boolean | "indeterminate">("indeterminate");
  return (
    <form dir="rtl" onSubmit={onSubmit}>
      <Checkbox
        id="select-all"
        label="انتخاب همه"
        checked={checked}
        onCheckedChange={(next) => {
          onChange(next);
          setChecked(next);
        }}
      />
      <label htmlFor="select-all">انتخاب همه</label>
      <button type="submit">Submit</button>
    </form>
  );
}

describe("Checkbox", () => {
  it("reflects checked state and toggles on click", () => {
    const onChange = vi.fn();
    render(<Checkbox checked={false} onCheckedChange={onChange} label="Select row" />);
    const cb = screen.getByRole("checkbox", { name: "Select row" });
    expect(cb).toHaveAttribute("aria-checked", "false");
    fireEvent.click(cb);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("renders an indeterminate (mixed) state for select-all", () => {
    render(<Checkbox checked="indeterminate" onCheckedChange={vi.fn()} label="Select all" />);
    expect(screen.getByRole("checkbox", { name: "Select all" })).toHaveAttribute(
      "aria-checked",
      "mixed",
    );
  });

  it("draws an unchecked box against a border strong enough to see on a white row", () => {
    render(<Checkbox checked={false} onCheckedChange={vi.fn()} label="Unchecked row" />);
    const cb = screen.getByRole("checkbox", { name: "Unchecked row" });
    expect(cb).not.toHaveClass("border-input");
    expect(cb.className).toContain("border-muted-foreground/50");
  });

  it("does not fire onCheckedChange when disabled", () => {
    const onChange = vi.fn();
    render(<Checkbox checked={false} onCheckedChange={onChange} label="Locked" disabled />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Locked" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("preserves mixed selectors and label activation without submitting an enclosing form", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onSubmit = vi.fn((event: React.FormEvent<HTMLFormElement>) => event.preventDefault());

    render(<CheckboxForm onChange={onChange} onSubmit={onSubmit} />);
    const checkbox = screen.getByRole("checkbox", { name: "انتخاب همه" });
    const indicator = () => checkbox.querySelector("[data-slot=checkbox-indicator]");
    expect(checkbox).toHaveAttribute("data-state", "indeterminate");
    expect(checkbox).toHaveAttribute("data-indeterminate");
    expect(indicator()).toHaveAttribute("data-state", "indeterminate");
    await user.tab();
    expect(checkbox).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(checkbox).toHaveAttribute("aria-checked", "mixed");
    expect(onChange).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
    await user.keyboard(" ");
    expect(checkbox).toBeChecked();
    expect(indicator()).toHaveAttribute("data-state", "checked");
    await user.click(screen.getByText("انتخاب همه"));
    expect(checkbox).not.toBeChecked();
    expect(checkbox).toHaveAttribute("data-state", "unchecked");
    expect(onChange.mock.calls).toEqual([[true], [false]]);
    expect(onSubmit).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
