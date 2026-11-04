// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { IDENTITY_ERROR_MESSAGES } from "@/constants/settingsIdentity";
import { settingsMessagesForLocale } from "@/features/identity/settingsMessages";

// Radix DropdownMenu relies on pointer-capture + scrollIntoView, which jsdom lacks.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));

type MutationResult = { ok: true; value: true } | { ok: false; error: string };
const { setUserAdminAction, setUserActiveAction, assignPermissionSetAction } = vi.hoisted(() => ({
  setUserAdminAction: vi.fn(
    (): Promise<MutationResult> => Promise.resolve({ ok: false, error: "unauthorized" }),
  ),
  setUserActiveAction: vi.fn(
    (): Promise<MutationResult> => Promise.resolve({ ok: true, value: true }),
  ),
  assignPermissionSetAction: vi.fn(
    (): Promise<{ ok: true; value: true } | { ok: false; error: string }> =>
      Promise.resolve({ ok: true, value: true }),
  ),
}));
vi.mock("@/features/identity/actions/users", () => ({
  setUserAdminAction,
  setUserActiveAction,
  assignPermissionSetAction,
}));

import { UserRowControls } from "./UserRowControls";

const SET_ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SET_REGULAR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const PROPS = {
  userId: "11111111-1111-1111-1111-111111111111",
  isAdmin: false,
  isActive: true,
  viewerIsAdmin: true,
  permissionSetId: SET_ADMIN,
  permissionSets: [
    { id: SET_ADMIN, name: "Admin set" },
    { id: SET_REGULAR, name: "Regular set" },
  ],
  onChanged: vi.fn(),
};

type User = ReturnType<typeof userEvent.setup>;

async function openMenu(user: User, menuName = "User actions"): Promise<void> {
  await user.click(screen.getByRole("button", { name: menuName }));
  await screen.findByRole("menu");
}

async function chooseAction(user: User, name: string, menuName = "User actions"): Promise<void> {
  await openMenu(user, menuName);
  const item = screen.getByRole("menuitem", { name });
  await waitFor(() => expect(item).not.toHaveAttribute("data-disabled"));
  await user.click(item);
}

async function openSetSubmenu(user: User, menuName = "User actions"): Promise<void> {
  await openMenu(user, menuName);
  await user.click(screen.getByRole("menuitem", { name: "Change permission set" }));
  await screen.findByRole("menuitemradio", { name: "Admin set" });
}

function chooseSet(name: string): void {
  fireEvent.click(screen.getByRole("menuitemradio", { name }));
}

describe("UserRowControls", () => {
  // At 1440px the two inline buttons overflowed the settings card and rendered as "Deacti...".
  // One overflow menu keeps the row inside the card at every width.
  it("collapses both actions into a single row overflow menu", async () => {
    const user = userEvent.setup();
    const { container } = render(<UserRowControls {...PROPS} />);
    expect(within(container).getAllByRole("button")).toHaveLength(1);

    await openMenu(user);
    expect(screen.getByRole("menuitem", { name: "Make admin" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Deactivate" })).toBeInTheDocument();
  });

  it("shows an inline error when the admin toggle fails", async () => {
    const user = userEvent.setup();
    render(<UserRowControls {...PROPS} />);
    await chooseAction(user, "Make admin");
    await waitFor(() => expect(setUserAdminAction).toHaveBeenCalled());
    expect(await screen.findByText(IDENTITY_ERROR_MESSAGES.permission)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("lists permission sets as one radio group with the current one selected", async () => {
    const user = userEvent.setup();
    render(<UserRowControls {...PROPS} />);
    await openSetSubmenu(user);
    expect(screen.getByRole("menuitemradio", { name: "Admin set" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("menuitemradio", { name: "Regular set" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("does not re-assign the set the user already has", async () => {
    const user = userEvent.setup();
    render(<UserRowControls {...PROPS} />);
    await openSetSubmenu(user);
    chooseSet("Admin set");
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    expect(assignPermissionSetAction).not.toHaveBeenCalled();
    expect(PROPS.onChanged).not.toHaveBeenCalled();
  });

  it("hides the submenu on an admin row when the viewer is not an admin", async () => {
    const user = userEvent.setup();
    render(<UserRowControls {...PROPS} isAdmin={true} viewerIsAdmin={false} />);
    await openMenu(user);
    expect(
      screen.queryByRole("menuitem", { name: "Change permission set" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the submenu on an admin row for an admin viewer", async () => {
    const user = userEvent.setup();
    render(<UserRowControls {...PROPS} isAdmin={true} viewerIsAdmin={true} />);
    await openMenu(user);
    expect(screen.getByRole("menuitem", { name: "Change permission set" })).toBeInTheDocument();
  });

  it("keeps the submenu on a regular row for a non-admin viewer", async () => {
    const user = userEvent.setup();
    render(<UserRowControls {...PROPS} isAdmin={false} viewerIsAdmin={false} />);
    await openMenu(user);
    expect(screen.getByRole("menuitem", { name: "Change permission set" })).toBeInTheDocument();
  });

  it("assigns the selected set and refreshes", async () => {
    const user = userEvent.setup();
    render(<UserRowControls {...PROPS} />);
    await openSetSubmenu(user);
    chooseSet("Regular set");
    await waitFor(() =>
      expect(assignPermissionSetAction).toHaveBeenCalledWith("csrf", {
        userId: PROPS.userId,
        setId: SET_REGULAR,
      }),
    );
    await waitFor(() => expect(PROPS.onChanged).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows an inline error when assignment fails", async () => {
    assignPermissionSetAction.mockResolvedValueOnce({ ok: false, error: "unauthorized" });
    const user = userEvent.setup();
    render(<UserRowControls {...PROPS} />);
    await openSetSubmenu(user);
    chooseSet("Regular set");
    expect(await screen.findByText(IDENTITY_ERROR_MESSAGES.permission)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(PROPS.onChanged).not.toHaveBeenCalled();
  });

  it("clears the error and calls onChanged when a retry succeeds", async () => {
    // First admin toggle fails, then the active toggle (succeeds) clears the error.
    const user = userEvent.setup();
    render(<UserRowControls {...PROPS} />);
    await chooseAction(user, "Make admin");
    expect(await screen.findByText(IDENTITY_ERROR_MESSAGES.permission)).toBeInTheDocument();
    await chooseAction(user, "Deactivate");
    await waitFor(() => expect(PROPS.onChanged).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

const mutations = ["admin", "active", "set"] as const;
type Mutation = (typeof mutations)[number];

function mutationDetails(kind: Mutation) {
  if (kind === "admin") {
    return { action: setUserAdminAction, payload: { userId: PROPS.userId, isAdmin: true } };
  }
  if (kind === "active") {
    return { action: setUserActiveAction, payload: { userId: PROPS.userId, isActive: false } };
  }
  return {
    action: assignPermissionSetAction,
    payload: { userId: PROPS.userId, setId: SET_REGULAR },
  };
}

async function chooseMutation(user: User, kind: Mutation, menuName: string) {
  if (kind === "set") {
    await openSetSubmenu(user, menuName);
    chooseSet("Regular set");
  } else {
    await chooseAction(user, kind === "admin" ? "Make admin" : "Deactivate", menuName);
  }
}

describe("User row transport recovery", () => {
  beforeEach(() => {
    setUserAdminAction.mockReset().mockResolvedValue({ ok: false, error: "unauthorized" });
    setUserActiveAction.mockReset().mockResolvedValue({ ok: true, value: true });
    assignPermissionSetAction.mockReset().mockResolvedValue({ ok: true, value: true });
  });

  it.each(mutations)("retains row context and retries a rejected %s request", async (kind) => {
    const { action, payload } = mutationDetails(kind);
    let reject!: (reason: unknown) => void;
    const pending = new Promise<MutationResult>((_resolve, rejectRequest) => {
      reject = rejectRequest;
    });
    action.mockReturnValueOnce(pending).mockResolvedValueOnce({ ok: true, value: true });
    const changed = vi.fn();
    const user = userEvent.setup();
    const userName = "Alexandra Morgan — International enterprise account management";
    const menuName = `User actions: ${userName}`;
    render(<UserRowControls {...PROPS} userName={userName} onChanged={changed} />);
    await chooseMutation(user, kind, menuName);
    const trigger = screen.getByRole("button", { name: menuName });
    expect(trigger).toBeDisabled();
    expect(action).toHaveBeenCalledExactlyOnceWith("csrf", payload);
    await user.click(trigger);
    expect(action).toHaveBeenCalledTimes(1);
    expect(changed).not.toHaveBeenCalled();

    await act(async () => {
      reject(new Error("private service diagnostic"));
      await pending.catch(() => undefined);
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      settingsMessagesForLocale("en")._errors.generic,
    );
    await waitFor(() => expect(trigger).toBeEnabled());
    expect(screen.queryByText("private service diagnostic")).not.toBeInTheDocument();
    expect(changed).not.toHaveBeenCalled();
    await chooseMutation(user, kind, menuName);
    await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(trigger).toBeEnabled());
    expect(action).toHaveBeenCalledTimes(2);
    expect(action).toHaveBeenNthCalledWith(2, "csrf", payload);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    for (const other of [setUserAdminAction, setUserActiveAction, assignPermissionSetAction]) {
      if (other !== action) expect(other).not.toHaveBeenCalled();
    }
  });

  it.each(mutations)(
    "keeps an acknowledged %s request successful if refresh throws",
    async (kind) => {
      const { action, payload } = mutationDetails(kind);
      action.mockResolvedValueOnce({ ok: true, value: true });
      const changed = vi.fn(() => {
        throw new Error("navigation interrupted");
      });
      const user = userEvent.setup();
      const userName = "Alexandra Morgan — International enterprise account management";
      const menuName = `User actions: ${userName}`;
      render(<UserRowControls {...PROPS} userName={userName} onChanged={changed} />);
      await chooseMutation(user, kind, menuName);
      await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(screen.getByRole("button", { name: menuName })).toBeEnabled());
      expect(action).toHaveBeenCalledExactlyOnceWith("csrf", payload);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.queryByText("navigation interrupted")).not.toBeInTheDocument();
    },
  );
});
