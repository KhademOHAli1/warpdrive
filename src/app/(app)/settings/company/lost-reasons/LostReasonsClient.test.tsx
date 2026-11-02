// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STRINGS } from "@/constants/strings";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const report = vi.hoisted(() => vi.fn());
vi.mock("@/components/shell/ActionErrorProvider", () => ({ useActionError: () => report }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
const actions = vi.hoisted(() => ({
  createLostReasonAction: vi.fn<() => Promise<MockVoidActionResult>>(() =>
    Promise.resolve({ ok: true }),
  ),
  renameLostReasonAction: vi.fn<() => Promise<MockVoidActionResult>>(() =>
    Promise.resolve({ ok: true }),
  ),
  archiveLostReasonAction: vi.fn<() => Promise<MockVoidActionResult>>(() =>
    Promise.resolve({ ok: true }),
  ),
  reorderLostReasonsAction: vi.fn<() => Promise<MockVoidActionResult>>(() =>
    Promise.resolve({ ok: true }),
  ),
}));
vi.mock("@/features/settings/lostReasonActions", () => actions);

import type { MockVoidActionResult } from "@/test/actionResult";
import { first } from "@/test/first";
import { LostReasonsClient } from "./LostReasonsClient";

const S = STRINGS.settings;
const ROWS = [{ id: "a", name: "Too expensive" }];

describe("LostReasonsClient", () => {
  it("lists the seeded reasons", () => {
    render(<LostReasonsClient rows={ROWS} />);
    expect(screen.getByText("Too expensive")).toBeInTheDocument();
  });

  // SETTINGS-08: after an add/rename/archive the handler calls router.refresh(), which re-runs the
  // server component and passes fresh props. The list must re-seed from those props without a hard
  // reload. Simulate the refreshed props via rerender.
  it("re-seeds the list when refreshed props arrive (add)", () => {
    const { rerender } = render(<LostReasonsClient rows={ROWS} />);
    rerender(<LostReasonsClient rows={[...ROWS, { id: "b", name: "Chose a competitor" }]} />);
    expect(screen.getByText("Chose a competitor")).toBeInTheDocument();
  });

  it("reflects a rename delivered via refreshed props", () => {
    const { rerender } = render(<LostReasonsClient rows={ROWS} />);
    rerender(<LostReasonsClient rows={[{ id: "a", name: "Budget cut" }]} />);
    expect(screen.getByText("Budget cut")).toBeInTheDocument();
    expect(screen.queryByText("Too expensive")).toBeNull();
  });

  it("drops an archived reason delivered via refreshed props", () => {
    const { rerender } = render(<LostReasonsClient rows={ROWS} />);
    rerender(<LostReasonsClient rows={[]} />);
    expect(screen.queryByText("Too expensive")).toBeNull();
  });
});

describe("LostReasonsClient surfaces failed mutations", () => {
  it("retains an added draft and releases busy state after transport failure", async () => {
    actions.createLostReasonAction.mockRejectedValueOnce(new Error("offline"));
    render(<LostReasonsClient rows={ROWS} />);
    fireEvent.change(screen.getByLabelText(S.lostReasonName), { target: { value: "New reason" } });
    fireEvent.click(screen.getByRole("button", { name: S.addLostReason }));
    await waitFor(() => expect(report).toHaveBeenCalledWith());
    expect(screen.getByLabelText(S.lostReasonName)).toHaveValue("New reason");
    expect(screen.getByRole("button", { name: S.addLostReason })).toBeEnabled();
  });

  it("retains a renamed draft after transport failure", async () => {
    actions.renameLostReasonAction.mockRejectedValueOnce(new Error("offline"));
    render(<LostReasonsClient rows={ROWS} />);
    fireEvent.click(screen.getByRole("button", { name: S.rename }));
    fireEvent.change(first(screen.getAllByLabelText(S.lostReasonName), "row draft"), {
      target: { value: "New name" },
    });
    fireEvent.click(screen.getByRole("button", { name: S.save }));
    await waitFor(() => expect(report).toHaveBeenCalledWith());
    expect(first(screen.getAllByLabelText(S.lostReasonName), "row draft")).toHaveValue("New name");
  });

  it("reports a rejected archive without removing the saved row", async () => {
    actions.archiveLostReasonAction.mockRejectedValueOnce(new Error("offline"));
    render(<LostReasonsClient rows={ROWS} />);
    fireEvent.click(screen.getByRole("button", { name: S.archive }));
    await waitFor(() => expect(report).toHaveBeenCalledWith());
    expect(screen.getByText("Too expensive")).toBeInTheDocument();
  });

  const TWO = [
    { id: "a", name: "Too expensive" },
    { id: "b", name: "Chose a competitor" },
  ];

  it("reports the error id when add is denied", async () => {
    actions.createLostReasonAction.mockResolvedValueOnce({
      ok: false,
      error: { id: "E_PERM_001" },
    });
    render(<LostReasonsClient rows={ROWS} />);
    fireEvent.change(screen.getByLabelText(S.lostReasonName), { target: { value: "New reason" } });
    fireEvent.click(screen.getByRole("button", { name: S.addLostReason }));
    await waitFor(() => expect(report).toHaveBeenCalledWith("E_PERM_001"));
  });

  it("reports the error id when rename is denied", async () => {
    actions.renameLostReasonAction.mockResolvedValueOnce({
      ok: false,
      error: { id: "E_PERM_001" },
    });
    render(<LostReasonsClient rows={ROWS} />);
    fireEvent.click(screen.getByRole("button", { name: S.rename }));
    // Two inputs share the "Lost reason" label (the row editor and the add field); the row editor
    // renders first, so target index 0.
    fireEvent.change(first(screen.getAllByLabelText(S.lostReasonName), "lost-reason input"), {
      target: { value: "Renamed" },
    });
    fireEvent.click(screen.getByRole("button", { name: S.save }));
    await waitFor(() => expect(report).toHaveBeenCalledWith("E_PERM_001"));
  });

  it("reports the error id when archive is denied", async () => {
    actions.archiveLostReasonAction.mockResolvedValueOnce({
      ok: false,
      error: { id: "E_PERM_001" },
    });
    render(<LostReasonsClient rows={ROWS} />);
    fireEvent.click(screen.getByRole("button", { name: S.archive }));
    await waitFor(() => expect(report).toHaveBeenCalledWith("E_PERM_001"));
  });

  it("reports the error id when reorder (move) is denied", async () => {
    actions.reorderLostReasonsAction.mockResolvedValueOnce({
      ok: false,
      error: { id: "E_PERM_001" },
    });
    render(<LostReasonsClient rows={TWO} />);
    fireEvent.click(first(screen.getAllByRole("button", { name: S.moveDown }), "move-down button"));
    await waitFor(() => expect(report).toHaveBeenCalledWith("E_PERM_001"));
  });

  it("restores the saved order immediately when a reorder is denied", async () => {
    actions.reorderLostReasonsAction.mockResolvedValueOnce({
      ok: false,
      error: { id: "E_PERM_001" },
    });
    render(<LostReasonsClient rows={TWO} />);
    fireEvent.click(first(screen.getAllByRole("button", { name: S.moveDown }), "move-down button"));
    await waitFor(() => expect(report).toHaveBeenCalledWith("E_PERM_001"));
    expect(first(screen.getAllByRole("listitem"), "first reason")).toHaveTextContent(
      "Too expensive",
    );
  });

  it("restores the saved order after a network rejection", async () => {
    actions.reorderLostReasonsAction.mockRejectedValueOnce(new Error("offline"));
    render(<LostReasonsClient rows={TWO} />);
    fireEvent.click(first(screen.getAllByRole("button", { name: S.moveDown }), "move-down button"));
    await waitFor(() => expect(report).toHaveBeenCalledWith());
    expect(first(screen.getAllByRole("listitem"), "first reason")).toHaveTextContent(
      "Too expensive",
    );
  });

  it("cancels a rename without sending an action", () => {
    render(<LostReasonsClient rows={ROWS} />);
    fireEvent.click(screen.getByRole("button", { name: S.rename }));
    fireEvent.change(first(screen.getAllByLabelText(S.lostReasonName), "reason draft"), {
      target: { value: "Unwanted draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: S.cancel }));
    expect(screen.getByText("Too expensive")).toBeInTheDocument();
    expect(actions.renameLostReasonAction).not.toHaveBeenCalled();
  });
});
