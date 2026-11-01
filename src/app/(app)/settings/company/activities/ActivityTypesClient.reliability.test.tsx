// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Result = { ok: true } | { ok: false; error: { id: string } };
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  rename: vi.fn(),
  toggle: vi.fn(),
  remove: vi.fn(),
  reorder: vi.fn(),
  refresh: vi.fn(),
  report: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
vi.mock("@/components/shell/ActionErrorProvider", () => ({ useActionError: () => mocks.report }));
vi.mock("@/features/activities/typeActions", () => ({
  createActivityTypeAction: mocks.create,
  renameActivityTypeAction: mocks.rename,
  setActivityTypeActiveAction: mocks.toggle,
  deleteActivityTypeAction: mocks.remove,
  reorderActivityTypesAction: mocks.reorder,
}));

import { ActivityTypesClient } from "./ActivityTypesClient";

const rows = [
  { id: "a", key: "alpha", name: "Alpha", icon: "task", isSystem: false, active: true },
  { id: "b", key: "beta", name: "Beta", icon: "meeting", isSystem: false, active: true },
];
function item(name: string) {
  return screen.getByText(name).closest("li") as HTMLElement;
}
function button(name: string, action: string) {
  return within(item(name)).getByRole("button", { name: new RegExp(`^${action}`) });
}
function order() {
  return screen
    .getAllByRole("listitem")
    .filter((e) => /Alpha|Beta/.test(e.textContent ?? ""))
    .map((e) => (e.textContent?.includes("Alpha") ? "Alpha" : "Beta"));
}
beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  for (const mock of [mocks.create, mocks.rename, mocks.toggle, mocks.remove, mocks.reorder])
    mock.mockResolvedValue({ ok: true });
});
afterEach(cleanup);

describe("Activity catalog recovery", () => {
  it.each(["result", "transport"])(
    "retains a failed add draft after %s failure",
    async (failure) => {
      if (failure === "result")
        mocks.create.mockResolvedValueOnce({ ok: false, error: { id: "E_PERM_001" } });
      else mocks.create.mockRejectedValueOnce(new Error("offline"));
      render(<ActivityTypesClient rows={rows} />);
      fireEvent.change(screen.getByLabelText("Activity type name"), {
        target: { value: "Customer research" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Add activity type" }));
      await waitFor(() => expect(mocks.report).toHaveBeenCalled());
      expect(screen.getByLabelText("Activity type name")).toHaveValue("Customer research");
      expect(screen.getByRole("button", { name: "Add activity type" })).toBeEnabled();
      expect(mocks.refresh).not.toHaveBeenCalled();
    },
  );

  it("keeps rejected rename editable and Cancel restores the saved name", async () => {
    mocks.rename.mockResolvedValueOnce({ ok: false, error: { id: "E_PERM_001" } });
    render(<ActivityTypesClient rows={rows} />);
    fireEvent.click(button("Alpha", "Rename"));
    const input = within(item("Beta").parentElement as HTMLElement).getAllByRole("textbox")[0];
    fireEvent.change(input as HTMLElement, { target: { value: "New name" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save/ }));
    await waitFor(() => expect(mocks.report).toHaveBeenCalledWith("E_PERM_001"));
    expect(input).toHaveValue("New name");
    expect(input).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Cancel/ }));
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("surfaces rejected toggles and preserves the stored active state", async () => {
    mocks.toggle.mockResolvedValueOnce({ ok: false, error: { id: "E_PERM_001" } });
    render(<ActivityTypesClient rows={rows} />);
    fireEvent.click(within(item("Alpha")).getByRole("switch"));
    await waitFor(() => expect(mocks.report).toHaveBeenCalledWith("E_PERM_001"));
    expect(within(item("Alpha")).getByRole("switch")).toBeChecked();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("rolls a rejected reorder back without waiting for refreshed props", async () => {
    let resolve: (value: Result) => void = () => {};
    const pending = new Promise<Result>((done) => {
      resolve = done;
    });
    mocks.reorder.mockReturnValueOnce(pending);
    render(<ActivityTypesClient rows={rows} />);
    fireEvent.click(button("Alpha", "Move down"));
    expect(order()).toEqual(["Beta", "Alpha"]);
    await act(async () => {
      resolve({ ok: false, error: { id: "E_PERM_001" } });
      await pending;
    });
    expect(order()).toEqual(["Alpha", "Beta"]);
    expect(mocks.report).toHaveBeenCalledWith("E_PERM_001");
  });

  it("prevents duplicate adds while the first request is pending", async () => {
    let resolve: (value: Result) => void = () => {};
    const pending = new Promise<Result>((done) => {
      resolve = done;
    });
    mocks.create.mockReturnValueOnce(pending);
    render(<ActivityTypesClient rows={rows} />);
    fireEvent.change(screen.getByLabelText("Activity type name"), {
      target: { value: "Research" },
    });
    const add = screen.getByRole("button", { name: "Add activity type" });
    fireEvent.click(add);
    fireEvent.click(add);
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(add).toBeDisabled();
    expect(within(item("Beta")).getByRole("switch")).toBeDisabled();
    await act(async () => {
      resolve({ ok: true });
      await pending;
    });
    expect(screen.getByLabelText("Activity type name")).toBeEnabled();
    expect(screen.getByLabelText("Activity type name")).toHaveValue("");
    expect(within(item("Beta")).getByRole("switch")).toBeEnabled();
  });
});
