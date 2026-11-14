// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NO_CALENDAR_FILTER } from "@/features/activities/calendarFilter";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { CalendarFilterBar } from "./CalendarFilterBar";

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
});

afterEach(cleanup);

const owners = [{ value: "u1", label: "Alice" }];
const types = [
  { key: "call", name: "Call" },
  { key: "meeting", name: "Meeting" },
];

describe("CalendarFilterBar", () => {
  it("sizes the owner and status pickers instead of letting them span the page", () => {
    // Both primitives default to w-full. Dropped into a bare flex row with no width of their own,
    // each claimed a whole line and wrapped, so two one-word pickers rendered full-bleed, stacked.
    render(
      <CalendarFilterBar
        filter={NO_CALENDAR_FILTER}
        onChange={() => {}}
        owners={owners}
        types={types}
      />,
    );
    for (const name of ["Owner", "Status"]) {
      const trigger = screen.getByLabelText(name);
      expect(trigger).not.toHaveClass("w-full");
      expect(trigger).toHaveClass("w-52");
    }
  });

  it("renders owner, status, and type controls", () => {
    render(
      <CalendarFilterBar
        filter={NO_CALENDAR_FILTER}
        onChange={() => {}}
        owners={owners}
        types={types}
      />,
    );
    expect(screen.getByLabelText("Owner")).toBeInTheDocument();
    expect(screen.getByLabelText("Status")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Meeting" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All" })).toBeInTheDocument();
  });

  it("keeps the Persian owner labels and restores focus after dismissing the picker", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const animationDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "getAnimations");
    Object.defineProperty(Element.prototype, "getAnimations", {
      configurable: true,
      value: () => [],
    });
    const style = document.createElement("style");
    // jsdom cannot open the native popover top layer.
    style.textContent = "[popover][data-slot='combobox-content'] { display: block !important }";
    document.head.append(style);

    const filtered = { ...NO_CALENDAR_FILTER, ownerId: "u1", typeKey: "meeting" };
    const view = render(
      <LocaleProvider locale="fa">
        <CalendarFilterBar filter={filtered} onChange={onChange} owners={owners} types={types} />
      </LocaleProvider>,
    );
    try {
      const owner = screen.getByRole("button", { name: "مسئول" });
      expect(owner).toHaveTextContent("Alice");
      owner.focus();
      await user.keyboard("[Space]");
      const search = screen.getByRole("combobox", { name: "جست‌وجو..." });
      await waitFor(() => expect(search).toHaveFocus());
      await user.keyboard("{Escape}");
      await waitFor(() => expect(owner).toHaveFocus());
      expect(onChange).not.toHaveBeenCalled();

      await user.keyboard("{Enter}");
      await user.click(screen.getByRole("option", { name: "همهٔ مسئولان" }));
      const allOwners = { ...filtered, ownerId: null };
      expect(onChange).toHaveBeenCalledExactlyOnceWith(allOwners);
      await waitFor(() => expect(owner).toHaveFocus());

      view.rerender(
        <LocaleProvider locale="fa">
          <CalendarFilterBar filter={allOwners} onChange={onChange} owners={owners} types={types} />
        </LocaleProvider>,
      );
      expect(owner).toHaveTextContent("همهٔ مسئولان");
      await user.keyboard("{Enter}");
      await user.click(screen.getByRole("option", { name: "Alice" }));
      expect(onChange.mock.calls).toEqual([[allOwners], [filtered]]);
    } finally {
      cleanup();
      style.remove();
      if (animationDescriptor) {
        Object.defineProperty(Element.prototype, "getAnimations", animationDescriptor);
      } else {
        Reflect.deleteProperty(Element.prototype, "getAnimations");
      }
    }
  });

  it("selects an activity type", () => {
    const onChange = vi.fn();
    render(
      <CalendarFilterBar
        filter={NO_CALENDAR_FILTER}
        onChange={onChange}
        owners={owners}
        types={types}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Meeting" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ typeKey: "meeting" }));
  });

  it("clears the type back to All", () => {
    const onChange = vi.fn();
    render(
      <CalendarFilterBar
        filter={{ ownerId: null, typeKey: "meeting", done: "all" }}
        onChange={onChange}
        owners={owners}
        types={types}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ typeKey: null }));
  });
});
