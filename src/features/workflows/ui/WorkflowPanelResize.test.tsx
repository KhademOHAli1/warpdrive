// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { WorkflowPanelResize } from "./WorkflowPanelResize";

afterEach(cleanup);

function Fixture({ locale, close }: { locale: "en" | "fa"; close: () => void }) {
  const [width, setWidth] = useState(400);
  return (
    <LocaleProvider locale={locale}>
      <WorkflowPanelResize width={width} onWidthChange={setWidth} onClose={close} />
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
    fireEvent.keyDown(separator, { key: wider });
    expect(separator.getAttribute("aria-valuenow")).toBe("420");
    fireEvent.keyDown(separator, { key: "End" });
    fireEvent.keyDown(separator, { key: wider });
    expect(separator.getAttribute("aria-valuenow")).toBe("600");
    fireEvent.keyDown(separator, { key: "Home" });
    expect(separator.getAttribute("aria-valuenow")).toBe("320");
    fireEvent.keyDown(separator, { key: "Enter" });
    expect(close).toHaveBeenCalledOnce();
  },
);
