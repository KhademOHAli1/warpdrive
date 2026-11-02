// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";

const routing = vi.hoisted(() => ({ query: "", replace: vi.fn(), refresh: vi.fn() }));
const { invite } = vi.hoisted(() => ({ invite: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: routing.replace, refresh: routing.refresh }),
  usePathname: () => "/settings/users",
  useSearchParams: () => new URLSearchParams(routing.query),
}));
vi.mock("@/features/identity/actions/invite", () => ({ inviteUserAction: invite }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));

import { UsersClient } from "./UsersClient";

const rows = [
  {
    id: "one",
    name: "Lea Weber",
    email: "lea@example.test",
    isAdmin: true,
    isActive: true,
    invitedAt: null,
    permissionSetId: null,
  },
  {
    id: "two",
    name: "نگار رضایی",
    email: "negar.rezaei@example.test",
    isAdmin: false,
    isActive: true,
    invitedAt: "2026-10-30",
    permissionSetId: null,
  },
  {
    id: "three",
    name: "Neda Muster",
    email: "neda@example.test",
    isAdmin: false,
    isActive: false,
    invitedAt: null,
    permissionSetId: null,
  },
];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  routing.query = "";
});

describe("people directory journey", () => {
  it("starts with the directory and opens a focused invitation without losing search", async () => {
    const user = userEvent.setup();
    render(<UsersClient rows={rows} permissionSets={[]} viewerIsAdmin />);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Email" })).not.toBeInTheDocument();
    await user.type(screen.getByRole("searchbox", { name: "Search users" }), "negar");
    const trigger = screen.getByRole("button", { name: "Invite a user" });
    await user.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Invite a user" });
    expect(within(dialog).getByRole("textbox", { name: "Email" })).toHaveAttribute("dir", "ltr");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
    expect(screen.getByRole("searchbox", { name: "Search users" })).toHaveValue("negar");
    expect(screen.queryByText("Lea Weber")).not.toBeInTheDocument();
    expect(screen.getByText("نگار رضایی")).toBeInTheDocument();
  });

  it("searches names and emails without changing the URL status filter", async () => {
    const user = userEvent.setup();
    routing.query = "status=deactivated&view=compact";
    render(<UsersClient rows={rows} permissionSets={[]} viewerIsAdmin />);
    await user.type(screen.getByRole("searchbox", { name: "Search users" }), "NEDA@EXAMPLE");
    expect(screen.getByText("Neda Muster")).toBeInTheDocument();
    expect(screen.queryByText("Lea Weber")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Active" }));
    expect(routing.replace).toHaveBeenCalledWith("/settings/users?status=active&view=compact", {
      scroll: false,
    });
  });

  it("explains no matching people and keeps the security task boundary discoverable", async () => {
    const user = userEvent.setup();
    render(<UsersClient rows={rows} permissionSets={[]} viewerIsAdmin />);
    await user.type(screen.getByRole("searchbox", { name: "Search users" }), "missing");
    expect(screen.getByRole("status")).toHaveTextContent("No users match these filters.");
    expect(screen.getByRole("link", { name: "Security administration" })).toHaveAttribute(
      "href",
      "/settings/security-admin",
    );
  });

  it("isolates directory email addresses and identifies each row action by person", () => {
    render(<UsersClient rows={rows} permissionSets={[]} viewerIsAdmin />);
    expect(screen.getByRole("button", { name: "User actions: Lea Weber" })).toBeInTheDocument();
    for (const email of screen.getAllByText("lea@example.test")) {
      expect(email.closest("bdi")).toHaveAttribute("dir", "ltr");
    }
  });

  it("keeps a pending invitation open and preserves inputs after a rejected request", async () => {
    const user = userEvent.setup();
    let reject: (reason: unknown) => void = vi.fn();
    invite.mockReturnValueOnce(
      new Promise<never>((_resolve, rejectTask) => {
        reject = rejectTask;
      }),
    );
    render(<UsersClient rows={rows} permissionSets={[]} viewerIsAdmin />);
    await user.click(screen.getByRole("button", { name: "Invite a user" }));
    const dialog = screen.getByRole("dialog", { name: "Invite a user" });
    await user.type(within(dialog).getByRole("textbox", { name: "Email" }), "new@example.test");
    await user.type(within(dialog).getByRole("textbox", { name: "Name" }), "New Person");
    await user.click(within(dialog).getByRole("button", { name: "Invite" }));
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Invite a user" })).toBeInTheDocument();
    reject(new Error(ERROR_IDS.PERM_DENIED));
    expect(await within(dialog).findByRole("alert")).toBeInTheDocument();
    expect(within(dialog).getByRole("textbox", { name: "Email" })).toHaveValue("new@example.test");
    expect(within(dialog).getByRole("textbox", { name: "Name" })).toHaveValue("New Person");
    expect(await within(dialog).findByRole("button", { name: "Invite" })).toBeEnabled();
    expect(invite).toHaveBeenCalledTimes(1);
  });
});
