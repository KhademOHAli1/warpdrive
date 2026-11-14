// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { settingsMessagesForLocale } from "@/features/identity/settingsMessages";
import type { CustomFieldOption } from "@/types/customFields";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const report = vi.hoisted(() => vi.fn());
vi.mock("@/components/shell/ActionErrorProvider", () => ({ useActionError: () => report }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));

const actions = vi.hoisted(() => ({
  addOptionAction: vi.fn<() => Promise<MockVoidActionResult>>(() => Promise.resolve({ ok: true })),
  archiveOptionAction: vi.fn<() => Promise<MockVoidActionResult>>(() =>
    Promise.resolve({ ok: true }),
  ),
  renameOptionAction: vi.fn<() => Promise<MockVoidActionResult>>(() =>
    Promise.resolve({ ok: true }),
  ),
}));
vi.mock("@/features/custom-fields/actions", () => actions);

import type { MockVoidActionResult } from "@/test/actionResult";
import { OptionEditor } from "./OptionEditor";

const S = settingsMessagesForLocale("en");
const OPTIONS: CustomFieldOption[] = [{ id: "o1", label: "Red", archived: false }];

describe("OptionEditor surfaces failed mutations", () => {
  it("keeps option edits local until Save and supports Cancel", async () => {
    render(<OptionEditor defId="d1" options={OPTIONS} />);
    const label = screen.getByLabelText(`${S.optionLabel}: Red`);
    fireEvent.change(label, { target: { value: "Crimson" } });
    fireEvent.blur(label);
    expect(actions.renameOptionAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: S.cancel }));
    expect(label).toHaveValue("Red");
    fireEvent.change(label, { target: { value: "Crimson" } });
    fireEvent.click(screen.getByRole("button", { name: S.save }));
    await waitFor(() =>
      expect(actions.renameOptionAction).toHaveBeenCalledWith(
        { id: "d1", optionId: "o1", label: "Crimson" },
        "csrf",
      ),
    );
    const saved = await screen.findByRole("status");
    expect(saved).toHaveTextContent(S.saved);
    expect(saved).toHaveClass("basis-full", "text-xs", "text-muted-foreground");
    fireEvent.change(label, { target: { value: "Ruby" } });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("keeps failed new option input and releases pending state after a rejected request", async () => {
    let rejectAdd: (reason: unknown) => void = () => {};
    actions.addOptionAction.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectAdd = reject;
        }),
    );
    render(<OptionEditor defId="d1" options={OPTIONS} />);
    fireEvent.change(screen.getByLabelText(S.newOption), { target: { value: "Blue" } });
    const add = screen.getByRole("button", { name: S.addOption });
    fireEvent.click(add);
    fireEvent.click(add);
    expect(actions.addOptionAction).toHaveBeenCalledTimes(1);
    expect(add).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(S._extra.saving);
    rejectAdd(new Error("offline"));
    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent(S._errors.generic);
    expect(error).toHaveClass("basis-full", "text-xs", "text-destructive");
    expect(screen.getByLabelText(S.newOption)).toHaveValue("Blue");
    expect(add).toBeEnabled();
  });
  it("reports the error id when adding an option is denied", async () => {
    actions.addOptionAction.mockResolvedValueOnce({ ok: false, error: { id: "E_PERM_001" } });
    render(<OptionEditor defId="d1" options={OPTIONS} />);
    fireEvent.change(screen.getByLabelText(S.newOption), { target: { value: "Blue" } });
    fireEvent.click(screen.getByRole("button", { name: S.addOption }));
    await waitFor(() => expect(report).toHaveBeenCalledWith("E_PERM_001"));
  });

  it("reports the error id when removing an option is denied", async () => {
    actions.archiveOptionAction.mockResolvedValueOnce({ ok: false, error: { id: "E_PERM_001" } });
    render(<OptionEditor defId="d1" options={OPTIONS} />);
    fireEvent.click(screen.getByRole("button", { name: S.removeOption }));
    await waitFor(() => expect(report).toHaveBeenCalledWith("E_PERM_001"));
  });

  it("reports the error id when renaming an option is denied", async () => {
    actions.renameOptionAction.mockResolvedValueOnce({ ok: false, error: { id: "E_PERM_001" } });
    render(<OptionEditor defId="d1" options={OPTIONS} />);
    fireEvent.change(screen.getByLabelText(`${S.optionLabel}: Red`), {
      target: { value: "Crimson" },
    });
    fireEvent.click(screen.getByRole("button", { name: S.save }));
    await waitFor(() => expect(report).toHaveBeenCalledWith("E_PERM_001"));
  });
});
