// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STRINGS } from "@/constants/strings";
import type { MockActionResult } from "@/test/actionResult";

const { createDefAction } = vi.hoisted(() => ({
  createDefAction: vi.fn<() => Promise<MockActionResult<{ id: string }>>>(() =>
    Promise.resolve({ ok: true, value: { id: "created" } }),
  ),
}));
vi.mock("@/features/custom-fields/actions", () => ({ createDefAction }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));

import { CreateFieldDialog } from "./CreateFieldDialog";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const S = STRINGS.settings;

describe("CreateFieldDialog", () => {
  it("preserves the draft after a rejected request and blocks duplicate submit and dismissal while saving", async () => {
    const user = userEvent.setup();
    let rejectCreate: (reason: unknown) => void = () => {};
    createDefAction.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectCreate = reject;
        }),
    );
    const onCreated = vi.fn();
    render(<CreateFieldDialog target="deal" entityLabel="Deal" onCreated={onCreated} />);
    fireEvent.click(screen.getByRole("button", { name: S.addField }));
    fireEvent.change(screen.getByLabelText(S.fieldName), { target: { value: "Budget" } });
    fireEvent.click(screen.getByRole("button", { name: S.addField }));
    expect(screen.getByRole("button", { name: S.creating })).toBeDisabled();
    expect(screen.getByRole("button", { name: S.cancel })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(createDefAction).toHaveBeenCalledTimes(1);
    rejectCreate(new Error("offline"));
    expect(await screen.findByRole("alert")).toHaveTextContent(S.addFieldFailed);
    expect(screen.getByLabelText(S.fieldName)).toHaveValue("Budget");
    expect(screen.getByRole("button", { name: S.addField })).toBeEnabled();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("keeps option validation and parses Persian separators for the selected entity", async () => {
    const onCreated = vi.fn();
    render(<CreateFieldDialog target="person" entityLabel="Person" onCreated={onCreated} />);
    fireEvent.click(screen.getByRole("button", { name: S.addField }));
    fireEvent.change(screen.getByLabelText(S.fieldName), { target: { value: "Priority" } });
    fireEvent.click(screen.getByLabelText(S.fieldType));
    fireEvent.click(screen.getByRole("option", { name: "single option" }));
    fireEvent.click(screen.getByRole("button", { name: S.addField }));
    expect(await screen.findByRole("alert")).toHaveTextContent(S.fieldOptionsRequired);
    expect(createDefAction).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(S.fieldOptions), {
      target: { value: "کم، متوسط, زیاد" },
    });
    fireEvent.click(screen.getByRole("button", { name: S.addField }));
    await waitFor(() =>
      expect(createDefAction).toHaveBeenCalledWith(
        {
          targetEntity: "person",
          type: "single_option",
          name: "Priority",
          options: [
            { id: expect.any(String), label: "کم" },
            { id: expect.any(String), label: "متوسط" },
            { id: expect.any(String), label: "زیاد" },
          ],
        },
        "csrf",
      ),
    );
    expect(onCreated).toHaveBeenCalledOnce();
  });
});
