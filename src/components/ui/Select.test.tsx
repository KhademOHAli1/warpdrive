// @vitest-environment jsdom
// src/components/ui/Select.test.tsx
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Select } from "./Select";

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => {
  cleanup();
});

describe("Select", () => {
  const options = [
    { value: "a", label: "Call" },
    { value: "b", label: "Meeting" },
  ];

  it("shows the selected label and emits on change", () => {
    const onChange = vi.fn();
    render(<Select value="a" onChange={onChange} options={options} ariaLabel="Type" />);
    const trigger = screen.getByLabelText("Type");
    expect(trigger).toHaveTextContent("Call");
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: "Meeting" }));
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("renders a leading icon for options that have one", () => {
    const onChange = vi.fn();
    const iconOptions = [
      { value: "a", label: "Call", icon: <span data-testid="call-icon">C</span> },
      { value: "b", label: "Meeting" },
    ];
    render(<Select value="a" onChange={onChange} options={iconOptions} ariaLabel="Type" />);
    fireEvent.click(screen.getByLabelText("Type"));
    expect(screen.getByTestId("call-icon")).toBeInTheDocument();
  });

  it("keeps nonconsecutive headings separate while updating options in place", () => {
    const onChange = vi.fn();
    const items = [
      { value: "", label: "None" },
      { value: "a", label: "Call", group: "Tasks" },
      { value: "b", label: "Meeting", group: "Tasks" },
      { value: "c", label: "Reminder" },
      { value: "d", label: "Email", group: "Tasks" },
    ];
    const mounted = render(
      <Select value="d" onChange={onChange} options={items} ariaLabel="Type" />,
    );
    fireEvent.click(screen.getByLabelText("Type"));
    const list = screen.getByRole("listbox");
    expect(
      within(list)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["None", "Call", "Meeting", "Reminder", "Email"]);
    const groups = within(list).getAllByRole("group", { name: "Tasks" });
    expect(groups.map((group) => within(group).getAllByRole("option").length)).toEqual([2, 1]);
    expect(
      within(list).getByRole("option", { name: "Reminder" }).closest('[role="group"]'),
    ).toBeNull();

    mounted.rerender(
      <Select
        value="d"
        onChange={onChange}
        options={items.filter((item) => item.value !== "b")}
        ariaLabel="Type"
      />,
    );
    expect(within(list).getAllByRole("group", { name: "Tasks" })).toEqual(groups);
    expect(within(list).queryByRole("option", { name: "Meeting" })).toBeNull();
    fireEvent.click(within(list).getByRole("option", { name: "None" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith("");
  });

  // Radix reserves value="" internally to mean "nothing selected, show the placeholder".
  // Many callers pass a real option like { value: "", label: "None" } (priority, org, owner,
  // source channel, default visibility), so when "" IS the selected value, Radix shows the
  // placeholder text instead of that option's label, and swallows re-selecting it. Opening the
  // dropdown must show and let you choose that option; the trigger must reflect its label.
  it("shows the empty-value option's label on the trigger, not the placeholder", () => {
    const onChange = vi.fn();
    const emptyOptions = [
      { value: "", label: "None" },
      { value: "b", label: "Meeting" },
    ];
    render(<Select value="" onChange={onChange} options={emptyOptions} ariaLabel="Type" />);
    const trigger = screen.getByLabelText("Type");
    expect(trigger).toHaveTextContent("None");
  });

  it("renders the empty-value option in the dropdown and decodes it back to onChange('')", () => {
    const onChange = vi.fn();
    const emptyOptions = [
      { value: "", label: "None" },
      { value: "b", label: "Meeting" },
    ];
    render(<Select value="b" onChange={onChange} options={emptyOptions} ariaLabel="Type" />);
    fireEvent.click(screen.getByLabelText("Type"));
    expect(screen.getByRole("option", { name: "None" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "None" }));
    expect(onChange).toHaveBeenCalledWith("");
  });

  // Radix portals the selected item's text into the trigger from an effect, so the server HTML
  // (and the first client paint) left an empty box on the board sort and the timeline range.
  it("paints the selected label in the server HTML", () => {
    const html = renderToString(
      <Select value="a" onChange={() => {}} options={options} ariaLabel="Type" />,
    );
    expect(html).toContain("Call");
  });

  // The EMPTY_SENTINEL that lets value: "" be a real option also means Radix's internal value is
  // never empty, so Radix's own placeholder never fires. The trigger has to render it itself.
  it("shows the placeholder when the value is empty and no option matches it", () => {
    render(
      <Select
        value=""
        onChange={vi.fn()}
        options={options}
        ariaLabel="Type"
        placeholder="Sort by"
      />,
    );
    expect(screen.getByLabelText("Type")).toHaveTextContent("Sort by");
  });

  // Options that arrive async (the dashboard pipeline picker) leave the value pointing at nothing
  // for the first render, which used to paint an empty box.
  it("shows the placeholder when the value matches no option yet", () => {
    render(
      <Select
        value="pipeline-1"
        onChange={vi.fn()}
        options={[]}
        ariaLabel="Pipeline"
        placeholder="Select pipeline"
      />,
    );
    expect(screen.getByLabelText("Pipeline")).toHaveTextContent("Select pipeline");
  });

  it("keeps custom trigger content ahead of the placeholder", () => {
    render(
      <Select
        value=""
        onChange={vi.fn()}
        options={options}
        ariaLabel="Type"
        placeholder="Sort by"
        triggerContent={<span>Custom</span>}
      />,
    );
    const trigger = screen.getByLabelText("Type");
    expect(trigger).toHaveTextContent("Custom");
    expect(trigger).not.toHaveTextContent("Sort by");
  });

  it("does not open or report a change while disabled", () => {
    const onChange = vi.fn();
    const options = [
      { value: "a", label: "Call" },
      { value: "b", label: "Meeting" },
    ];
    render(<Select value="a" onChange={onChange} options={options} ariaLabel="Type" disabled />);

    const trigger = screen.getByLabelText("Type");
    expect(trigger).toBeDisabled();
    fireEvent.click(trigger);
    expect(screen.queryByRole("option", { name: "Meeting" })).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
