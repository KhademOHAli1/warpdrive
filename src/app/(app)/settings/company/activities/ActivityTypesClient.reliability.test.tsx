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

describe("Acknowledged activity catalog writes", () => {
  beforeEach(() => {
    mocks.refresh.mockImplementation(() => {
      throw new Error("navigation interrupted");
    });
  });

  async function expectSavedWithoutWriteError() {
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved"));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(mocks.report).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  }

  it("clears an acknowledged add draft when refresh throws", async () => {
    render(<ActivityTypesClient rows={rows} />);
    const input = screen.getByLabelText("Activity type name");
    fireEvent.change(input, { target: { value: "Customer research" } });
    fireEvent.click(screen.getByRole("button", { name: "Add activity type" }));
    await expectSavedWithoutWriteError();
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create).toHaveBeenCalledWith(
      { name: "Customer research", icon: "call", key: "customer_research" },
      "csrf",
    );
    expect(input).toHaveValue("");
    expect(input).toBeEnabled();
    expect(screen.getByRole("button", { name: "Add activity type" })).toBeDisabled();
  });

  it("commits an acknowledged rename and closes its editor when refresh throws", async () => {
    render(<ActivityTypesClient rows={rows} />);
    fireEvent.click(button("Alpha", "Rename"));
    fireEvent.change(screen.getByLabelText("Activity type name: Alpha"), {
      target: { value: "Customer research" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Save/ }));
    await expectSavedWithoutWriteError();
    expect(mocks.rename).toHaveBeenCalledTimes(1);
    expect(mocks.rename).toHaveBeenCalledWith({ id: "a", name: "Customer research" }, "csrf");
    expect(screen.getByText("Customer research")).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Activity type name: Customer research"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rename: Customer research" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Rename: Customer research" }));
    expect(screen.getByRole("button", { name: /^Save/ })).toBeDisabled();
  });

  it("keeps an acknowledged active-state change when refresh throws", async () => {
    render(<ActivityTypesClient rows={rows} />);
    fireEvent.click(within(item("Alpha")).getByRole("switch"));
    await expectSavedWithoutWriteError();
    expect(mocks.toggle).toHaveBeenCalledTimes(1);
    expect(mocks.toggle).toHaveBeenCalledWith({ id: "a", active: false }, "csrf");
    const toggle = within(item("Alpha")).getByRole("switch");
    expect(toggle).not.toBeChecked();
    expect(toggle).toBeEnabled();
  });

  it("keeps an acknowledged deletion when refresh throws", async () => {
    render(<ActivityTypesClient rows={rows} />);
    fireEvent.click(button("Alpha", "Delete"));
    await expectSavedWithoutWriteError();
    expect(mocks.remove).toHaveBeenCalledTimes(1);
    expect(mocks.remove).toHaveBeenCalledWith({ id: "a" }, "csrf");
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(within(item("Beta")).getByRole("switch")).toBeEnabled();
  });

  it("retains an acknowledged reorder and releases the catalog lock when refresh throws", async () => {
    render(<ActivityTypesClient rows={rows} />);
    fireEvent.click(button("Alpha", "Move down"));
    expect(order()).toEqual(["Beta", "Alpha"]);
    await expectSavedWithoutWriteError();
    expect(mocks.reorder).toHaveBeenCalledTimes(1);
    expect(mocks.reorder).toHaveBeenCalledWith({ orderedIds: ["b", "a"] }, "csrf");
    expect(order()).toEqual(["Beta", "Alpha"]);
    expect(button("Alpha", "Move up")).toBeEnabled();
    expect(button("Beta", "Move down")).toBeEnabled();
  });
});
