// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

import { INLINE_CONTROL_SURFACE } from "@/components/ui/inlineControlSurface";
import { VisibilityControl } from "./VisibilityControl";

// C1: the composer visibility control is now interactive (a shadcn DropdownMenu offering
// Private / Shared), not a read-only label and not a native <select>. It reflects the current
// value and reports a change via onChange so the composer can thread it into the send payload.
describe("VisibilityControl", () => {
  it("shows the shared label when value is shared", () => {
    render(<VisibilityControl value="shared" onChange={vi.fn()} />);
    expect(screen.getByText("Visible to everyone")).toBeInTheDocument();
  });

  it("shows the private label when value is private", () => {
    render(<VisibilityControl value="private" onChange={vi.fn()} />);
    expect(screen.getByText("Private to you")).toBeInTheDocument();
  });

  it("is interactive: opens a menu and reports selecting Private", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<VisibilityControl value="shared" onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: /visibility/i }));
    await user.click(screen.getByRole("menuitem", { name: /private/i }));
    expect(onChange).toHaveBeenCalledWith("private");
  });

  it("reports selecting Shared when currently private", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<VisibilityControl value="private" onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: /visibility/i }));
    await user.click(screen.getByRole("menuitem", { name: /everyone|shared/i }));
    expect(onChange).toHaveBeenCalledWith("shared");
  });

  // The picker is the reference for every inline control that pairs a box with visible text, so it
  // must draw its hover surface from the shared token rather than a copy that can drift.
  it("draws its hover surface from the shared inline-control token", () => {
    render(<VisibilityControl value="shared" onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /visibility/i })).toHaveClass(
      ...INLINE_CONTROL_SURFACE.split(" "),
    );
  });

  it("uses the shadcn menu, never a native select", () => {
    const { container } = render(<VisibilityControl value="shared" onChange={vi.fn()} />);
    expect(container.querySelector("select")).toBeNull();
  });

  it("keeps reader menu events inside the control and disables the pending trigger", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onRowClick = vi.fn();
    const onRowPointerDown = vi.fn();
    const { rerender } = render(
      // biome-ignore lint/a11y/noStaticElementInteractions: This test observes bubbling on a parent without adding an interactive element.
      // biome-ignore lint/a11y/useKeyWithClickEvents: The parent observes click events and has no user action.
      <div onClick={onRowClick} onPointerDown={onRowPointerDown}>
        <VisibilityControl variant="reader" value="private" onChange={onChange} disabled={false} />
      </div>,
    );
    const trigger = screen.getByRole("button", { name: "Private conversation" });
    await user.click(trigger);
    expect(onRowPointerDown).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Shared" }));
    expect(onChange.mock.calls).toEqual([["shared"]]);
    expect(onRowClick).not.toHaveBeenCalled();

    rerender(
      <div>
        <VisibilityControl variant="reader" value="private" onChange={onChange} disabled />
      </div>,
    );
    expect(screen.getByRole("button", { name: "Private conversation" })).toBeDisabled();
  });
});
