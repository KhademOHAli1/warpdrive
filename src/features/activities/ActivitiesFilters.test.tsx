// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ActivitiesFilters } from "./ActivitiesFilters";
import type { ActivityListFilter } from "./schemas";

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
  // The remaining Radix controls measure their popups with ResizeObserver.
  global.ResizeObserver = class {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  };
});

afterEach(() => {
  cleanup();
});

const baseFilter: ActivityListFilter = {
  ownerId: null,
  done: "open",
  from: null,
  to: null,
  typeKey: null,
};
const owners = [{ value: "u1", label: "Ann", avatarName: "Ann" }];
const types = [
  { key: "call", name: "Call" },
  { key: "custom1", name: "Site visit" },
];

describe("ActivitiesFilters", () => {
  it("emits a filter with the chosen owner, done state, and type", () => {
    const onChange = vi.fn();
    render(
      <ActivitiesFilters filter={baseFilter} onChange={onChange} owners={owners} types={types} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Site visit" })); // custom type tab
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ typeKey: "custom1" }));
  });

  it("the All tab resets typeKey to null", () => {
    const onChange = vi.fn();
    render(
      <ActivitiesFilters
        filter={{ ...baseFilter, typeKey: "call" }}
        onChange={onChange}
        owners={owners}
        types={types}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ typeKey: null }));
  });

  it("a custom type slugified to 'all' does not collide with the All tab", () => {
    const onChange = vi.fn();
    const collidingTypes = [...types, { key: "all", name: "All" }];
    render(
      <ActivitiesFilters
        filter={baseFilter}
        onChange={onChange}
        owners={owners}
        types={collidingTypes}
      />,
    );
    const allButtons = screen.getAllByRole("button", { name: "All" });
    expect(allButtons).toHaveLength(2);

    fireEvent.click(allButtons[1] as HTMLElement); // the custom type tab keyed "all"
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ typeKey: "all" }));

    fireEvent.click(allButtons[0] as HTMLElement); // the synthetic "All types" tab
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ typeKey: null }));
  });

  it("filters by owner with the keyboard and clears the filter with All owners", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onSubmit = vi.fn();
    const animationDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "getAnimations");
    Object.defineProperty(Element.prototype, "getAnimations", {
      configurable: true,
      value: () => [],
    });
    const style = document.createElement("style");
    // jsdom cannot open the native popover top layer.
    style.textContent = "[popover][data-slot='combobox-content'] { display: block !important }";
    document.head.append(style);

    const filterForm = (filter: ActivityListFilter) => (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <ActivitiesFilters filter={filter} onChange={onChange} owners={owners} types={types} />
      </form>
    );
    const view = render(filterForm(baseFilter));
    try {
      const owner = screen.getByRole("button", { name: "Owner" });
      expect(owner).toHaveClass("w-52");
      expect(owner).not.toHaveClass("w-full");
      expect(owner).toHaveTextContent("All owners");

      owner.focus();
      await user.keyboard("{Enter}");
      let search = screen.getByRole("combobox", { name: "Search..." });
      await waitFor(() => expect(search).toHaveFocus());
      expect(fireEvent.keyDown(search, { key: "Tab", shiftKey: true })).toBe(true);
      expect(owner).toHaveFocus();
      expect(onChange).not.toHaveBeenCalled();

      await user.keyboard("{Enter}");
      search = screen.getByRole("combobox", { name: "Search..." });
      await waitFor(() => expect(search).toHaveFocus());
      await user.type(search, "Ann");
      expect(onChange).not.toHaveBeenCalled();
      await user.keyboard("{Enter}");
      const selectedFilter = { ...baseFilter, ownerId: "u1" };
      expect(onChange).toHaveBeenCalledExactlyOnceWith(selectedFilter);
      await waitFor(() => expect(owner).toHaveFocus());

      view.rerender(filterForm(selectedFilter));
      expect(owner).toHaveTextContent("Ann");
      await user.keyboard("{Enter}");
      await user.click(screen.getByRole("option", { name: "All owners" }));
      expect(onChange.mock.calls).toEqual([[selectedFilter], [baseFilter]]);
      expect(onSubmit).not.toHaveBeenCalled();
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

  it("changing the Status select sets done", () => {
    const onChange = vi.fn();
    render(
      <ActivitiesFilters filter={baseFilter} onChange={onChange} owners={owners} types={types} />,
    );
    fireEvent.click(screen.getByLabelText("Status"));
    fireEvent.click(screen.getByRole("option", { name: "Completed" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ done: "done" }));
  });

  it("picking a From date sets filter.from", async () => {
    const onChange = vi.fn();
    render(
      <ActivitiesFilters filter={baseFilter} onChange={onChange} owners={owners} types={types} />,
    );
    fireEvent.click(screen.getByLabelText("From"));
    // findByText: the calendar is a next/dynamic chunk that loads on open.
    fireEvent.click(await screen.findByText("15"));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ from: expect.any(String) }),
    );
  });

  it("picking a To date sets filter.to", () => {
    const onChange = vi.fn();
    render(
      <ActivitiesFilters filter={baseFilter} onChange={onChange} owners={owners} types={types} />,
    );
    fireEvent.click(screen.getByLabelText("To"));
    fireEvent.click(screen.getByText("15"));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ to: expect.any(String) }));
  });
});
