// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DealStatusBadge } from "./DealStatusBadge";

afterEach(cleanup);

describe("DealStatusBadge", () => {
  it.each([
    ["open", "Open"],
    ["won", "Won"],
    ["lost", "Lost"],
  ] as const)("renders the %s detail state with its status label", (status, label) => {
    render(<DealStatusBadge status={status} presentation="detail" />);
    const badge = screen.getByLabelText(`Deal status: ${label}`);
    expect(badge).toHaveTextContent(label);
    expect(badge).not.toHaveAttribute("data-deal-status");
  });

  it.each([
    ["won", "Won"],
    ["lost", "Lost"],
  ] as const)("renders the %s compact state with its selector", (status, label) => {
    render(<DealStatusBadge status={status} />);
    const badge = screen.getByText(label);
    expect(badge).toHaveAttribute("data-deal-status", status);
    expect(badge).not.toHaveAttribute("aria-label");
  });

  it.each(["open", undefined] as const)("omits the %s compact state", (status) => {
    const { container } = render(<DealStatusBadge status={status} />);
    expect(container).toBeEmptyDOMElement();
  });
});
