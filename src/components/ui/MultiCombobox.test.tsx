// @vitest-environment jsdom
// src/components/ui/MultiCombobox.test.tsx
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MultiCombobox } from "./MultiCombobox";

function DuplicateGuestPicker({ onChange }: { onChange: (values: string[]) => void }) {
  const [values, setValues] = useState<string[]>([]);
  return (
    <MultiCombobox
      values={values}
      onChange={(next) => {
        onChange(next);
        setValues(next);
      }}
      options={[
        { value: " guest-1", label: "Mia Silva" },
        { value: "guest-1 ", label: "Mia Silva" },
      ]}
      ariaLabel="Participants"
    />
  );
}

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
  // cmdk observes its list's size to manage height; jsdom has no ResizeObserver.
  global.ResizeObserver = class {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  };
});

afterEach(() => {
  cleanup();
});

describe("MultiCombobox", () => {
  const options = [
    { value: "mia", label: "Mia Silva" },
    { value: "kai", label: "Kai Carter" },
  ];

  // The chip row is the one buttonVariants consumer that wraps its content, so it has to opt back
  // out of the base button's nowrap. A long guest name would otherwise run past the field edge.
  it("lets a long chip label wrap instead of overflowing the field", () => {
    render(
      <MultiCombobox
        values={["mia"]}
        onChange={vi.fn()}
        options={options}
        ariaLabel="Participants"
        placeholder="Add participants"
      />,
    );
    const chipRow = screen.getByLabelText("Participants").parentElement;
    expect(chipRow).toHaveClass("whitespace-normal");
    expect(chipRow).not.toHaveClass("whitespace-nowrap");
  });

  it("shows the placeholder when nothing is selected", () => {
    render(
      <MultiCombobox
        values={[]}
        onChange={vi.fn()}
        options={options}
        ariaLabel="Participants"
        placeholder="Add participants"
      />,
    );
    expect(screen.getByText("Add participants")).toBeInTheDocument();
  });

  it("renders a chip for each selected value", () => {
    render(
      <MultiCombobox
        values={["mia"]}
        onChange={vi.fn()}
        options={options}
        ariaLabel="Participants"
      />,
    );
    // Popover is closed, so the only "Mia Silva" text is the chip.
    expect(screen.getByText("Mia Silva")).toBeInTheDocument();
  });

  it("adds an option to the selection when picked from the list", () => {
    const onChange = vi.fn();
    render(
      <MultiCombobox
        values={["mia"]}
        onChange={onChange}
        options={options}
        ariaLabel="Participants"
      />,
    );
    fireEvent.click(screen.getByLabelText("Participants"));
    fireEvent.click(screen.getByRole("option", { name: /Kai Carter/ }));
    expect(onChange).toHaveBeenCalledWith(["mia", "kai"]);
  });

  it("toggles an already-selected option off when picked again", () => {
    const onChange = vi.fn();
    render(
      <MultiCombobox
        values={["mia", "kai"]}
        onChange={onChange}
        options={options}
        ariaLabel="Participants"
      />,
    );
    fireEvent.click(screen.getByLabelText("Participants"));
    fireEvent.click(screen.getByRole("option", { name: /Mia Silva/ }));
    expect(onChange).toHaveBeenCalledWith(["kai"]);
  });

  it("removes a value when its chip remove button is clicked", () => {
    const onChange = vi.fn();
    render(
      <MultiCombobox
        values={["mia", "kai"]}
        onChange={onChange}
        options={options}
        ariaLabel="Participants"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove Mia Silva" }));
    expect(onChange).toHaveBeenCalledWith(["kai"]);
  });

  it("chooses both identically labeled guests by keyboard without changing their IDs", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DuplicateGuestPicker onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Participants" }));
    const search = screen.getByPlaceholderText("Search...");
    await user.type(search, "mi si");
    const [first, second] = screen.getAllByRole("option", { name: "Mia Silva" });
    if (!first || !second) throw new Error("Expected two separately selectable guests");

    await user.keyboard("{ArrowDown}");
    await waitFor(() => expect(search).toHaveAttribute("aria-activedescendant", second.id));
    await user.keyboard("{Enter}{ArrowUp}");
    await waitFor(() => expect(search).toHaveAttribute("aria-activedescendant", first.id));
    await user.keyboard("{Enter}");

    expect(onChange.mock.calls).toEqual([[["guest-1 "]], [["guest-1 ", " guest-1"]]]);
  });
});
