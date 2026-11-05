// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { WorkflowPanelResize } from "./WorkflowPanelResize";

afterEach(cleanup);

function Fixture({
  locale,
  close,
  resize = () => {},
}: {
  locale: "en" | "fa";
  close: () => void;
  resize?: (resizing: boolean) => void;
}) {
  const [width, setWidth] = useState(400);
  return (
    <LocaleProvider locale={locale}>
      <WorkflowPanelResize
        panelId="inspector"
        width={width}
        onWidthChange={setWidth}
        onResizingChange={resize}
        onClose={close}
      />
    </LocaleProvider>
  );
}

it.each([
  { locale: "en", wider: "ArrowLeft" },
  { locale: "fa", wider: "ArrowRight" },
] as const)(
  "resizes from the panel edge and keeps width bounded in $locale",
  ({ locale, wider }) => {
    const close = vi.fn();
    render(<Fixture locale={locale} close={close} />);
    const separator = screen.getByRole("separator");
    expect(separator.getAttribute("aria-controls")).toBe("inspector");
    fireEvent.keyDown(separator, { key: wider });
    expect(separator.getAttribute("aria-valuenow")).toBe("410");
    fireEvent.keyDown(separator, { key: "End" });
    fireEvent.keyDown(separator, { key: wider });
    expect(separator.getAttribute("aria-valuenow")).toBe("600");
    fireEvent.keyDown(separator, { key: "Home" });
    expect(separator.getAttribute("aria-valuenow")).toBe("320");
    fireEvent.keyDown(separator, { key: "Enter" });
    expect(close).toHaveBeenCalledOnce();
  },
);

function pointer(target: HTMLElement, type: string, clientX: number) {
  const event = new MouseEvent(type, { clientX, button: 0, bubbles: true });
  Object.defineProperty(event, "pointerId", { value: 1 });
  fireEvent(target, event);
}

it("shrinks during dragging, restores the starting width on Escape, and collapses on click", () => {
  const close = vi.fn();
  const resize = vi.fn();
  render(<Fixture locale="en" close={close} resize={resize} />);
  const separator = screen.getByRole("separator");
  pointer(separator, "pointerdown", 300);
  pointer(separator, "pointermove", 305);
  expect(separator.getAttribute("aria-valuenow")).toBe("400");
  pointer(separator, "pointermove", 350);
  expect(separator.getAttribute("aria-valuenow")).toBe("350");
  fireEvent.keyDown(window, { key: "Escape" });
  expect(separator.getAttribute("aria-valuenow")).toBe("400");
  expect(resize.mock.calls).toEqual([[true], [false]]);
  expect(close).not.toHaveBeenCalled();

  pointer(separator, "pointerdown", 300);
  pointer(separator, "pointerup", 380);
  expect(separator.getAttribute("aria-valuenow")).toBe("320");
  expect(close).not.toHaveBeenCalled();
  pointer(separator, "pointerdown", 380);
  pointer(separator, "pointerup", 380);
  expect(close).toHaveBeenCalledOnce();
});
