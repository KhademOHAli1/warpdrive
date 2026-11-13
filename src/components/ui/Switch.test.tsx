// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Switch } from "./Switch";

afterEach(cleanup);

function SwitchForm({
  onChange,
  onSubmit,
}: {
  onChange: (next: boolean) => void;
  onSubmit: React.FormEventHandler<HTMLFormElement>;
}) {
  const [checked, setChecked] = useState(false);
  return (
    <form onSubmit={onSubmit}>
      <label htmlFor="invite-admin">Administrator</label>
      <Switch
        id="invite-admin"
        checked={checked}
        onCheckedChange={(next) => {
          onChange(next);
          setChecked(next);
        }}
        label="Administrator"
      />
      <button type="submit">Invite</button>
    </form>
  );
}

describe("Switch", () => {
  it("reflects checked state and toggles on click", () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onCheckedChange={onChange} label="Track opens" />);
    const sw = screen.getByRole("switch", { name: "Track opens" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
    expect(sw).toHaveAttribute("aria-checked", "false");
  });

  it("provides shared hover feedback without animating disabled switches", () => {
    const { getByRole, rerender } = render(
      <Switch checked={false} onCheckedChange={vi.fn()} label="Hover preference" />,
    );
    const sw = getByRole("switch", { name: "Hover preference" });

    expect(sw).toHaveClass("hover:not-disabled:ring-4");
    expect(sw).toHaveClass("data-[state=unchecked]:hover:not-disabled:bg-muted-foreground/40");
    expect(sw).toHaveClass("motion-safe:active:not-disabled:scale-[0.96]");

    rerender(<Switch checked disabled onCheckedChange={vi.fn()} label="Hover preference" />);
    expect(sw).toBeDisabled();
    expect(sw).toHaveClass("data-[state=checked]:hover:not-disabled:bg-success/85");
  });

  it("toggles with Enter or Space inside a form without submitting it", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onSubmit = vi.fn((event: React.FormEvent<HTMLFormElement>) => event.preventDefault());

    render(<SwitchForm onChange={onChange} onSubmit={onSubmit} />);
    const sw = screen.getByRole("switch", { name: "Administrator" });
    await user.tab();
    expect(sw).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(sw).toBeChecked();
    fireEvent.keyDown(sw, { key: "Enter", repeat: true });
    fireEvent.keyDown(sw, { key: "Enter", isComposing: true });
    fireEvent.keyDown(sw, { key: "Enter", keyCode: 229 });
    expect(sw).toBeChecked();
    await user.keyboard(" ");
    expect(sw).not.toBeChecked();
    await user.click(screen.getByText("Administrator"));
    expect(sw).toBeChecked();
    expect(onChange.mock.calls).toEqual([[true], [false], [true]]);
    expect(onSubmit).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Invite" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("keeps checked selectors on the switch and the thumb in an RTL subtree", () => {
    const { rerender } = render(
      <div dir="rtl">
        <Switch checked={false} onCheckedChange={vi.fn()} label="ادامه" />
      </div>,
    );
    const sw = screen.getByRole("switch", { name: "ادامه" });
    const thumb = sw.querySelector('[data-slot="switch-thumb"]');
    expect(sw).toHaveAttribute("data-slot", "switch");
    expect(sw).toHaveAttribute("data-size", "default");
    expect(sw).toHaveAttribute("data-state", "unchecked");
    expect(thumb).toHaveAttribute("data-state", "unchecked");

    rerender(
      <div dir="rtl">
        <Switch checked onCheckedChange={vi.fn()} label="ادامه" />
      </div>,
    );
    expect(sw).toHaveAttribute("data-state", "checked");
    expect(thumb).toHaveAttribute("data-state", "checked");
    expect(thumb).toHaveAttribute("data-checked");
    expect(thumb).toHaveClass(
      "data-checked:translate-x-[calc(100%-2px)]",
      "rtl:data-checked:-translate-x-[calc(100%-2px)]",
      "motion-reduce:transition-none",
    );
  });
});
