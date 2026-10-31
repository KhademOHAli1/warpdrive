// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const { update, refresh } = vi.hoisted(() => ({ update: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
vi.mock("@/features/identity/actions/permission-sets", () => ({
  createPermissionSetAction: vi.fn(),
  updateFlagsAction: update,
}));

import { PermissionSetsClient } from "./PermissionSetsClient";

const sets = [
  { id: "sales", name: "Sales", flags: { "deal.create": true }, isDefault: true },
  { id: "support", name: "Support", flags: { "contact.create": true }, isDefault: false },
];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("focused permission-set journey", () => {
  it("shows one selected editor and opens creation only when requested", async () => {
    const user = userEvent.setup();
    render(<PermissionSetsClient sets={sets} />);
    expect(screen.getByRole("heading", { name: "Sales" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Support" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Permission set name" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sales" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Create a permission set" }));
    expect(screen.getByRole("dialog", { name: "Create a permission set" })).toBeInTheDocument();
  });

  it("tracks dirty flags and Cancel restores the last saved values", async () => {
    const user = userEvent.setup();
    render(<PermissionSetsClient sets={sets} />);
    expect(screen.getByRole("button", { name: "Save flags" })).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: "Create contacts" }));
    expect(screen.getByRole("button", { name: "Save flags" })).toBeEnabled();
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("checkbox", { name: "Create contacts" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Save flags" })).toBeDisabled();
    expect(update).not.toHaveBeenCalled();
  });

  it("can cancel a role switch without losing its unsaved draft", async () => {
    const user = userEvent.setup();
    render(<PermissionSetsClient sets={sets} />);
    await user.click(screen.getByRole("checkbox", { name: "Create contacts" }));
    await user.click(screen.getByRole("button", { name: "Support" }));
    const confirm = screen.getByRole("alertdialog", { name: "Unsaved permission changes" });
    expect(within(confirm).getByRole("button", { name: "Save and switch" })).toBeInTheDocument();
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "Sales" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Create contacts" })).toBeChecked();
  });

  it("discards only after confirmation and does not submit the discarded changes", async () => {
    const user = userEvent.setup();
    render(<PermissionSetsClient sets={sets} />);
    await user.click(screen.getByRole("checkbox", { name: "Create contacts" }));
    await user.click(screen.getByRole("button", { name: "Support" }));
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(screen.getByRole("heading", { name: "Support" })).toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Sales" }));
    expect(screen.getByRole("checkbox", { name: "Create contacts" })).not.toBeChecked();
  });

  it("keeps the role and draft on failed Save and switch, then switches only after success", async () => {
    const user = userEvent.setup();
    update.mockResolvedValueOnce({ ok: false, error: "unauthorized" });
    render(<PermissionSetsClient sets={sets} />);
    await user.click(screen.getByRole("checkbox", { name: "Create contacts" }));
    await user.click(screen.getByRole("button", { name: "Support" }));
    await user.click(screen.getByRole("button", { name: "Save and switch" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sales" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Create contacts" })).toBeChecked();
    update.mockResolvedValueOnce({ ok: true, value: true });
    await user.click(screen.getByRole("button", { name: "Support" }));
    await user.click(screen.getByRole("button", { name: "Save and switch" }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Support" })).toBeInTheDocument(),
    );
    expect(update).toHaveBeenCalledWith("csrf", expect.objectContaining({ setId: "sales" }));
  });

  it("does not confuse a set named Admin with an administrator account", () => {
    render(
      <PermissionSetsClient
        sets={[
          { id: "admin-set", name: "Admin", flags: { "deal.create": true }, isDefault: false },
        ]}
      />,
    );
    expect(screen.getByRole("checkbox", { name: "Create deals" })).toBeEnabled();
    expect(screen.getByText(/flags apply to non-administrator accounts/i)).toBeInTheDocument();
  });

  it("blocks discard and further switching until Save and switch has a result", async () => {
    const user = userEvent.setup();
    let finish: (result: { ok: false; error: string }) => void = vi.fn();
    update.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(<PermissionSetsClient sets={sets} />);
    await user.click(screen.getByRole("checkbox", { name: "Create contacts" }));
    await user.click(screen.getByRole("button", { name: "Support" }));
    await user.click(screen.getByRole("button", { name: "Save and switch" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByRole("button", { name: "Discard changes" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
    finish({ ok: false, error: "unauthorized" });
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sales" })).toBeInTheDocument();
  });
});
