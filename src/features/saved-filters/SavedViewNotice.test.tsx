// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SavedViewNotice } from "./SavedViewNotice";

afterEach(cleanup);

it("moves from checking to query recovery, then replaces retry with the unavailable action", () => {
  const retry = vi.fn();
  const clear = vi.fn();
  const { rerender } = render(<SavedViewNotice state="checking" onRetry={retry} />);

  const status = screen.getByRole("status");
  expect(status).toHaveAttribute("aria-busy", "true");
  expect(status).toHaveTextContent("Checking this saved view");
  expect(status).toHaveTextContent(
    "The saved conditions are being checked before records are shown.",
  );
  expect(within(status).queryByRole("button")).toBeNull();

  rerender(<SavedViewNotice state="query-error" onRetry={retry} />);
  const failed = screen.getByRole("alert");
  expect(failed).toBe(status);
  expect(failed).toHaveAttribute("aria-busy", "false");
  expect(failed).toHaveTextContent(
    "Could not load this view. Your selected conditions are unchanged.",
  );
  const retryButton = within(failed).getByRole("button", { name: "Try again" });
  fireEvent.click(retryButton);
  expect(retry).toHaveBeenCalledOnce();

  rerender(<SavedViewNotice state="unavailable" missing name="فروش" onClear={clear} />);
  const unavailable = screen.getByRole("alert");
  expect(retryButton).not.toBeInTheDocument();
  expect(unavailable).not.toHaveAttribute("aria-busy");
  expect(unavailable).toHaveTextContent("This saved view is unavailable");
  expect(unavailable).toHaveTextContent(
    "This saved view was removed or is no longer available to you.",
  );
  const name = within(unavailable).getByText("فروش");
  expect(name.tagName).toBe("BDI");
  expect(name).toHaveAttribute("dir", "auto");
  fireEvent.click(within(unavailable).getByRole("button", { name: "Show all permitted records" }));
  expect(clear).toHaveBeenCalledOnce();
  expect(retry).toHaveBeenCalledOnce();
});
