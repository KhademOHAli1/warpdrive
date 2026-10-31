// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { DndContext } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STRINGS } from "@/constants/strings";
import type { FieldRow } from "./types";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const report = vi.hoisted(() => vi.fn());
vi.mock("@/components/shell/ActionErrorProvider", () => ({ useActionError: () => report }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));

const S = STRINGS.settings;

const actions = vi.hoisted(() => ({
  archiveDefAction: vi.fn<() => Promise<MockActionResult<{ id: string }>>>(() =>
    Promise.resolve({ ok: true, value: { id: "d1" } }),
  ),
  renameDefAction: vi.fn<() => Promise<MockActionResult<{ id: string }>>>(() =>
    Promise.resolve({ ok: true, value: { id: "d1" } }),
  ),
  setDefFlagsAction: vi.fn<() => Promise<MockVoidActionResult>>(() =>
    Promise.resolve({ ok: true }),
  ),
}));
vi.mock("@/features/custom-fields/actions", () => actions);

import type { MockActionResult, MockVoidActionResult } from "@/test/actionResult";
import { FieldRowItem } from "./FieldRowItem";

const ROW: FieldRow = {
  id: "d1",
  name: "Budget",
  type: "monetary",
  options: [],
  isImportant: false,
  showInAddForm: false,
};

// FieldRowItem calls useSortable, which reads dnd-kit's React context, so it must render
// under the same DndContext/SortableContext nesting FieldList provides in production.
function renderRow(row: FieldRow): ReturnType<typeof render> {
  return render(
    <DndContext>
      <SortableContext items={[row.id]}>
        <ul>
          <FieldRowItem row={row} isFirst isLast onMove={vi.fn()} />
        </ul>
      </SortableContext>
    </DndContext>,
  );
}

describe("FieldRowItem placement toggles", () => {
  it("identifies the field in each placement switch name", () => {
    renderRow(ROW);
    expect(screen.getByRole("switch", { name: "Important: Budget" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Show in add form: Budget" })).toBeInTheDocument();
  });
  it("uses the shared arrow reorder controls", () => {
    const onMove = vi.fn();
    render(
      <ul>
        <FieldRowItem row={ROW} isFirst={false} isLast onMove={onMove} />
      </ul>,
    );
    fireEvent.click(screen.getByRole("button", { name: S.moveUp }));
    expect(onMove).toHaveBeenCalledWith("up");
    expect(screen.getByRole("button", { name: S.moveDown })).toBeDisabled();
  });

  it("toggles Important via setDefFlagsAction, sending the full flag pair", async () => {
    renderRow(ROW);
    fireEvent.click(screen.getByRole("switch", { name: "Important: Budget" }));
    await waitFor(() =>
      expect(actions.setDefFlagsAction).toHaveBeenCalledWith(
        { id: "d1", isImportant: true, showInAddForm: false },
        "csrf",
      ),
    );
  });

  it("toggles Show in add form via setDefFlagsAction, sending the full flag pair", async () => {
    renderRow({ ...ROW, isImportant: true });
    fireEvent.click(screen.getByRole("switch", { name: "Show in add form: Budget" }));
    await waitFor(() =>
      expect(actions.setDefFlagsAction).toHaveBeenCalledWith(
        { id: "d1", isImportant: true, showInAddForm: true },
        "csrf",
      ),
    );
  });

  it("reflects the def's current flag state in the switches", () => {
    renderRow({ ...ROW, isImportant: true, showInAddForm: true });
    expect(screen.getByRole("switch", { name: "Important: Budget" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("switch", { name: "Show in add form: Budget" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });
});

describe("FieldRowItem surfaces failed mutations", () => {
  it("prevents duplicate rename requests and keeps the draft after a network rejection", async () => {
    let rejectSave: (reason: unknown) => void = () => {};
    actions.renameDefAction.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectSave = reject;
        }),
    );
    renderRow(ROW);
    fireEvent.click(screen.getByRole("button", { name: S.rename }));
    fireEvent.change(screen.getByLabelText(S.rename), { target: { value: "New budget" } });
    const save = screen.getByRole("button", { name: S.save });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(actions.renameDefAction).toHaveBeenCalledTimes(1);
    expect(save).toBeDisabled();
    rejectSave(new Error("offline"));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByLabelText(S.rename)).toHaveValue("New budget");
    expect(screen.getByRole("button", { name: S.save })).toBeEnabled();
  });
  it("reports the error id when archive is denied", async () => {
    actions.archiveDefAction.mockResolvedValueOnce({ ok: false, error: { id: "E_PERM_001" } });
    renderRow(ROW);
    fireEvent.click(screen.getByRole("button", { name: S.archive }));
    await waitFor(() => expect(report).toHaveBeenCalledWith("E_PERM_001"));
  });

  it("reports the error id when a rename is denied", async () => {
    actions.renameDefAction.mockResolvedValueOnce({ ok: false, error: { id: "E_PERM_001" } });
    renderRow(ROW);
    fireEvent.click(screen.getByRole("button", { name: S.rename }));
    fireEvent.change(screen.getByLabelText(S.rename), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: S.save }));
    await waitFor(() => expect(report).toHaveBeenCalledWith("E_PERM_001"));
  });

  it("reports the error id when a flag toggle is denied", async () => {
    actions.setDefFlagsAction.mockResolvedValueOnce({ ok: false, error: { id: "E_PERM_001" } });
    renderRow(ROW);
    fireEvent.click(screen.getByRole("switch", { name: `${S.important}: Budget` }));
    await waitFor(() => expect(report).toHaveBeenCalledWith("E_PERM_001"));
  });
});
