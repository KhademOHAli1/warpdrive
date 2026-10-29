// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ComposerFooter } from "./ComposerFooter";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2027-03-20T12:00:00Z"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderFooter(overrides: Partial<ComponentProps<typeof ComposerFooter>> = {}) {
  const onSendLater = vi.fn();
  const props = {
    canSend: true,
    sending: false,
    onSend: vi.fn(),
    onDiscard: vi.fn(),
    trackOpens: false,
    onTrackOpensChange: vi.fn(),
    trackLinks: false,
    onTrackLinksChange: vi.fn(),
    onSendLater,
    ...overrides,
  };
  const view = render(<ComposerFooter {...props} />);
  return { ...view, props, onSendLater };
}

function open(): void {
  fireEvent.click(screen.getByRole("button", { name: "Send later" }));
}
function time(value: string): void {
  const input = screen.getByLabelText("Send time");
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}
async function tomorrow(): Promise<void> {
  fireEvent.click(screen.getByLabelText("Send date"));
  fireEvent.click(await screen.findByRole("button", { name: "Sunday, March 21st, 2027" }));
}

describe("ComposerFooter Send later", () => {
  it("is disabled when there are no recipients", () => {
    renderFooter({ canSend: false });
    expect(screen.getByRole("button", { name: "Send later" })).toBeDisabled();
  });

  it("is disabled while a send is in flight", () => {
    renderFooter({ sending: true });
    expect(screen.getByRole("button", { name: "Send later" })).toBeDisabled();
  });

  it("is enabled when scheduling is available", () => {
    renderFooter();
    expect(screen.getByRole("button", { name: "Send later" })).not.toBeDisabled();
  });

  it("opens shared date and time controls for English too", () => {
    renderFooter();
    open();
    expect(screen.getByLabelText("Send date").tagName).toBe("BUTTON");
    expect(screen.getByLabelText("Send time")).toBeInTheDocument();
    expect(document.querySelector('input[type="datetime-local"]')).toBeNull();
    expect(screen.getByText(/Send time zone:.*UTC/)).toBeInTheDocument();
  });

  it("calls onSendLater with a future instant and closes the picker", async () => {
    const { onSendLater } = renderFooter();
    open();
    await tomorrow();
    time("09:00");
    fireEvent.click(screen.getByRole("button", { name: "Schedule" }));
    expect(onSendLater).toHaveBeenCalledTimes(1);
    expect(onSendLater.mock.calls[0]?.[0]).toEqual(new Date("2027-03-21T09:00:00Z"));
    expect(screen.queryByLabelText("Send time")).not.toBeInTheDocument();
  });

  it.each(["11:59", "12:00"])("rejects a past/now time %s without losing the draft", (clock) => {
    const { onSendLater } = renderFooter();
    open();
    time(clock);
    fireEvent.click(screen.getByRole("button", { name: "Schedule" }));
    expect(onSendLater).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Choose a time in the future");
    expect(screen.getByLabelText("Send time")).toHaveValue(clock);
  });

  it("requires a time instead of treating an empty clock as midnight", () => {
    const { onSendLater } = renderFooter();
    open();
    fireEvent.click(screen.getByRole("button", { name: "Schedule" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Choose a send date and time");
    expect(onSendLater).not.toHaveBeenCalled();
  });

  it("preserves a chosen schedule while the controls are temporarily closed", async () => {
    renderFooter();
    open();
    await tomorrow();
    time("09:00");
    open();
    expect(screen.queryByLabelText("Send time")).not.toBeInTheDocument();
    open();
    expect(screen.getByLabelText("Send date")).toHaveTextContent("03/21/2027");
    expect(screen.getByLabelText("Send time")).toHaveValue("09:00");
  });

  it("cannot confirm a schedule while sending becomes pending", async () => {
    const { props, onSendLater, rerender } = renderFooter();
    open();
    await tomorrow();
    time("09:00");
    rerender(<ComposerFooter {...props} sending />);
    const confirm = screen.getByRole("button", { name: "Schedule" });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(onSendLater).not.toHaveBeenCalled();
  });
});
