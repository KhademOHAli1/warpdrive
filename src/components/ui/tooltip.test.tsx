// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Tip, TooltipProvider } from "./tooltip";

afterEach(cleanup);

describe("Tip", () => {
  it("renders the trigger child and preserves its accessible name", () => {
    render(
      <TooltipProvider>
        <Tip label="Attach a file">
          <button type="button" aria-label="Attach a file">
            +
          </button>
        </Tip>
      </TooltipProvider>,
    );
    // The trigger (with its aria-label) is always in the DOM; the content only
    // portals in on hover/focus, so we assert the trigger, not the tip text.
    expect(screen.getByRole("button", { name: "Attach a file" })).toBeInTheDocument();
  });

  it("opens a keyboard-accessible hint without a detached arrow", async () => {
    render(
      <Tip label="فعالیت‌ها">
        <button type="button" aria-label="فعالیت‌ها">
          Calendar
        </button>
      </Tip>,
    );
    const trigger = screen.getByRole("button", { name: "فعالیت‌ها" });
    fireEvent.focus(trigger);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("فعالیت‌ها");
    expect(document.querySelector('[data-slot="tooltip-content"] svg')).toBeNull();
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});
