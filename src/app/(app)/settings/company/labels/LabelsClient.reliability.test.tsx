// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Result = { ok: true } | { ok: false; error: { id: string } };
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  rename: vi.fn(),
  color: vi.fn(),
  remove: vi.fn(),
  reorder: vi.fn(),
  refresh: vi.fn(),
  report: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
vi.mock("@/components/shell/ActionErrorProvider", () => ({ useActionError: () => mocks.report }));
vi.mock("@/features/labels/actions", () => ({
  createLabelAction: mocks.create,
  renameLabelAction: mocks.rename,
  setLabelColorAction: mocks.color,
  deleteLabelAction: mocks.remove,
  reorderLabelsAction: mocks.reorder,
}));

import { LabelsClient } from "./LabelsClient";

const rows = [
  { id: "a", name: "Alpha", color: "red" as const, target: "deal" as const },
  { id: "b", name: "Beta", color: "green" as const, target: "deal" as const },
];
function item(name: string) {
  return screen.getAllByText(name)[0]?.closest("li") as HTMLElement;
}
function order() {
  return screen
    .getAllByRole("listitem")
    .filter((e) => /Alpha|Beta/.test(e.textContent ?? ""))
    .map((e) => (e.textContent?.includes("Alpha") ? "Alpha" : "Beta"));
}
beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  for (const mock of [mocks.create, mocks.rename, mocks.color, mocks.remove, mocks.reorder])
    mock.mockResolvedValue({ ok: true });
});
afterEach(cleanup);

describe("Label catalog recovery", () => {
  it.each(["result", "transport"])(
    "reports a failed add and retains the draft after %s failure",
    async (failure) => {
      if (failure === "result")
        mocks.create.mockResolvedValueOnce({ ok: false, error: { id: "E_PERM_001" } });
      else mocks.create.mockRejectedValueOnce(new Error("offline"));
      render(<LabelsClient rows={rows} />);
      fireEvent.change(screen.getByLabelText("Deals Label name"), {
        target: { value: "Enterprise" },
      });
      fireEvent.click(screen.getAllByRole("button", { name: "Add label" })[0] as HTMLElement);
      await waitFor(() => expect(mocks.report).toHaveBeenCalled());
      expect(screen.getByLabelText("Deals Label name")).toHaveValue("Enterprise");
      expect(mocks.refresh).not.toHaveBeenCalled();
    },
  );

  it("keeps a rejected rename open and allows cancellation", async () => {
    mocks.rename.mockResolvedValueOnce({ ok: false, error: { id: "E_PERM_001" } });
    render(<LabelsClient rows={rows} />);
    const alpha = item("Alpha");
    fireEvent.click(within(alpha).getByRole("button", { name: /^Rename/ }));
    const input = within(alpha).getByRole("textbox");
    fireEvent.change(input, { target: { value: "New name" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save/ }));
    await waitFor(() => expect(mocks.report).toHaveBeenCalledWith("E_PERM_001"));
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue("New name");
    fireEvent.click(screen.getByRole("button", { name: /^Cancel/ }));
    expect(screen.queryByDisplayValue("New name")).not.toBeInTheDocument();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("restores a rejected optimistic order immediately", async () => {
    let resolve: (value: Result) => void = () => {};
    const pending = new Promise<Result>((done) => {
      resolve = done;
    });
    mocks.reorder.mockReturnValueOnce(pending);
    render(<LabelsClient rows={rows} />);
    fireEvent.click(within(item("Alpha")).getByRole("button", { name: "Move down" }));
    expect(order()).toEqual(["Beta", "Alpha"]);
    await act(async () => {
      resolve({ ok: false, error: { id: "E_PERM_001" } });
      await pending;
    });
    expect(order()).toEqual(["Alpha", "Beta"]);
    expect(mocks.report).toHaveBeenCalledWith("E_PERM_001");
  });

  it("prevents duplicate creation while the request is pending", async () => {
    let resolve: (value: Result) => void = () => {};
    const pending = new Promise<Result>((done) => {
      resolve = done;
    });
    mocks.create.mockReturnValueOnce(pending);
    render(<LabelsClient rows={rows} />);
    fireEvent.change(screen.getByLabelText("Deals Label name"), {
      target: { value: "Enterprise" },
    });
    const add = screen.getAllByRole("button", { name: "Add label" })[0] as HTMLElement;
    fireEvent.click(add);
    fireEvent.click(add);
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(add).toBeDisabled();
    await act(async () => {
      resolve({ ok: true });
      await pending;
    });
    expect(screen.getByLabelText("Deals Label name")).toBeEnabled();
    expect(screen.getByLabelText("Deals Label name")).toHaveValue("");
  });
});
