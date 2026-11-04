// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

describe("Acknowledged label catalog writes", () => {
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

  it("clears only the acknowledged entity add draft when refresh throws", async () => {
    render(<LabelsClient rows={rows} />);
    const input = screen.getByLabelText("Deals Label name");
    fireEvent.change(input, { target: { value: "Enterprise" } });
    const personDraft = screen.getByLabelText("People Label name");
    fireEvent.change(personDraft, { target: { value: "Keep this draft" } });
    fireEvent.click(
      within(input.closest("li") as HTMLElement).getByRole("button", { name: "Add label" }),
    );
    await expectSavedWithoutWriteError();
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create).toHaveBeenCalledWith(
      { target: "deal", name: "Enterprise", color: "red" },
      "csrf",
    );
    expect(input).toHaveValue("");
    expect(input).toBeEnabled();
    expect(personDraft).toHaveValue("Keep this draft");
    expect(
      within(input.closest("li") as HTMLElement).getByRole("button", { name: "Add label" }),
    ).toBeDisabled();
  });

  it("commits an acknowledged rename and closes its editor when refresh throws", async () => {
    render(<LabelsClient rows={rows} />);
    fireEvent.click(within(item("Alpha")).getByRole("button", { name: "Rename: Alpha" }));
    fireEvent.change(screen.getByLabelText("Label name: Alpha"), {
      target: { value: "Enterprise" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Save/ }));
    await expectSavedWithoutWriteError();
    expect(mocks.rename).toHaveBeenCalledTimes(1);
    expect(mocks.rename).toHaveBeenCalledWith({ id: "a", name: "Enterprise" }, "csrf");
    expect(screen.getByText("Enterprise")).toBeInTheDocument();
    expect(screen.queryByLabelText("Label name: Enterprise")).not.toBeInTheDocument();
    const rename = screen.getByRole("button", { name: "Rename: Enterprise" });
    expect(rename).toBeEnabled();
    fireEvent.click(rename);
    expect(screen.getByRole("button", { name: /^Save/ })).toBeDisabled();
  });

  it("retains an acknowledged color choice when refresh throws", async () => {
    render(<LabelsClient rows={rows} />);
    await userEvent.click(screen.getByRole("combobox", { name: "Color: Alpha" }));
    await userEvent.click(screen.getByRole("option", { name: "blue" }));
    await expectSavedWithoutWriteError();
    expect(mocks.color).toHaveBeenCalledTimes(1);
    expect(mocks.color).toHaveBeenCalledWith({ id: "a", color: "blue" }, "csrf");
    const picker = screen.getByRole("combobox", { name: "Color: Alpha" });
    expect(picker).toHaveTextContent("blue");
    expect(picker).toBeEnabled();
  });

  it("keeps an acknowledged deletion when refresh throws", async () => {
    render(<LabelsClient rows={rows} />);
    fireEvent.click(within(item("Alpha")).getByRole("button", { name: "Delete: Alpha" }));
    await expectSavedWithoutWriteError();
    expect(mocks.remove).toHaveBeenCalledTimes(1);
    expect(mocks.remove).toHaveBeenCalledWith({ id: "a" }, "csrf");
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete: Beta" })).toBeEnabled();
  });

  it("retains an acknowledged reorder and releases the catalog lock when refresh throws", async () => {
    render(<LabelsClient rows={rows} />);
    fireEvent.click(within(item("Alpha")).getByRole("button", { name: "Move down" }));
    expect(order()).toEqual(["Beta", "Alpha"]);
    await expectSavedWithoutWriteError();
    expect(mocks.reorder).toHaveBeenCalledTimes(1);
    expect(mocks.reorder).toHaveBeenCalledWith({ orderedIds: ["b", "a"] }, "csrf");
    expect(order()).toEqual(["Beta", "Alpha"]);
    expect(within(item("Alpha")).getByRole("button", { name: "Move up" })).toBeEnabled();
    expect(within(item("Beta")).getByRole("button", { name: "Move down" })).toBeEnabled();
  });
});
