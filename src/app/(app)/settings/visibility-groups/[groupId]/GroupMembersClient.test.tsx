// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { IDENTITY_ERROR_MESSAGES } from "@/constants/settingsIdentity";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { settingsMessagesForLocale } from "@/features/identity/settingsMessages";

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
  // cmdk observes its list's size to manage height; jsdom has no ResizeObserver.
  global.ResizeObserver = class {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.documentElement.removeAttribute("dir");
  document.documentElement.removeAttribute("lang");
});

vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
vi.mock("@/features/i18n/actions", () => ({ saveLocalePreferencesAction: vi.fn() }));

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

type Result = { ok: true; value: true } | { ok: false; error: string };
const { addGroupMemberAction, removeGroupMemberAction } = vi.hoisted(() => ({
  addGroupMemberAction: vi.fn((): Promise<Result> => Promise.resolve({ ok: true, value: true })),
  removeGroupMemberAction: vi.fn((): Promise<Result> => Promise.resolve({ ok: true, value: true })),
}));
vi.mock("@/features/identity/actions/groups", () => ({
  addGroupMemberAction,
  removeGroupMemberAction,
}));

import { GroupMembersClient, GroupMembersUnavailable } from "./GroupMembersClient";

const ANN = { userId: "11111111-1111-1111-1111-111111111111", name: "Ann" };
const BOB = { id: "22222222-2222-2222-2222-222222222222", name: "Bob", avatarUrl: null };

beforeEach(() => {
  addGroupMemberAction.mockReset().mockResolvedValue({ ok: true, value: true });
  removeGroupMemberAction.mockReset().mockResolvedValue({ ok: true, value: true });
  refresh.mockReset();
});

function pickBob(label = "Add member"): void {
  fireEvent.click(screen.getByLabelText(label));
  const option = screen.getAllByRole("option").find((entry) => entry.textContent?.includes("Bob"));
  if (option === undefined) throw new Error("Expected Bob in the group member picker");
  fireEvent.click(option);
}

function deferred() {
  let settle!: (result: Result) => void;
  const promise = new Promise<Result>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

describe("GroupMembersClient", () => {
  it("renders the current member roster", () => {
    render(<GroupMembersClient groupId="g1" members={[ANN]} allUsers={[BOB]} />);
    expect(screen.getByText("Ann")).toBeInTheDocument();
  });

  it("removes a member and refreshes the page", async () => {
    render(<GroupMembersClient groupId="g1" members={[ANN]} allUsers={[BOB]} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Ann" }));
    await waitFor(() =>
      expect(removeGroupMemberAction).toHaveBeenCalledWith("csrf", {
        groupId: "g1",
        userId: ANN.userId,
      }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("adds the picked user and refreshes the page", async () => {
    render(<GroupMembersClient groupId="g1" members={[ANN]} allUsers={[BOB]} />);
    fireEvent.click(screen.getByLabelText("Add member"));
    // The picker option's accessible name doubles up the avatar's aria-label with the
    // visible text (both say "Bob"), so match by role + visible text instead of name.
    fireEvent.click(screen.getAllByRole("option").find((o) => o.textContent?.includes("Bob"))!);
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() =>
      expect(addGroupMemberAction).toHaveBeenCalledWith("csrf", {
        groupId: "g1",
        userId: BOB.id,
      }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("only offers non-member users in the picker", () => {
    render(
      <GroupMembersClient
        groupId="g1"
        members={[ANN]}
        allUsers={[{ ...BOB, id: ANN.userId, name: "Ann" }, BOB]}
      />,
    );
    fireEvent.click(screen.getByLabelText("Add member"));
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent("Bob");
  });

  it("shows an inline error when the remove action fails", async () => {
    removeGroupMemberAction.mockResolvedValueOnce({ ok: false, error: "unauthorized" });
    render(<GroupMembersClient groupId="g1" members={[ANN]} allUsers={[BOB]} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Ann" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(IDENTITY_ERROR_MESSAGES.permission);
  });

  it("renders the empty roster line from the muted token", () => {
    render(<GroupMembersClient groupId="g1" members={[]} allUsers={[BOB]} />);
    expect(screen.getByText("No members yet.")).toHaveClass("text-muted-foreground");
  });

  it.each(["returned", "rejected"] as const)(
    "retains the picked user and retries Add after a %s mutation failure",
    async (failure) => {
      if (failure === "returned") {
        addGroupMemberAction.mockResolvedValueOnce({ ok: false, error: "unauthorized" });
      } else {
        addGroupMemberAction.mockRejectedValueOnce(new Error("private database diagnostic"));
      }
      render(<GroupMembersClient groupId="g1" members={[ANN]} allUsers={[BOB]} />);
      pickBob();
      fireEvent.click(screen.getByRole("button", { name: "Add", exact: true }));
      expect(await screen.findByRole("alert")).toHaveTextContent(
        failure === "returned"
          ? IDENTITY_ERROR_MESSAGES.permission
          : IDENTITY_ERROR_MESSAGES.generic,
      );
      expect(screen.queryByText("private database diagnostic")).not.toBeInTheDocument();
      expect(screen.getByText("Ann")).toBeInTheDocument();
      expect(screen.getByLabelText("Add member")).toHaveTextContent("Bob");
      expect(screen.getByRole("button", { name: "Add", exact: true })).toBeEnabled();
      expect(refresh).not.toHaveBeenCalled();

      const retry = deferred();
      addGroupMemberAction.mockReturnValueOnce(retry.promise);
      fireEvent.click(screen.getByRole("button", { name: "Add", exact: true }));
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.getByLabelText("Add member")).toBeDisabled();
      expect(screen.getByLabelText("Add member")).toHaveTextContent("Bob");
      expect(screen.getByRole("button", { name: "Remove Ann" })).toBeDisabled();
      expect(refresh).not.toHaveBeenCalled();
      await act(async () => {
        retry.settle({ ok: true, value: true });
        await retry.promise;
      });
      expect(addGroupMemberAction).toHaveBeenCalledTimes(2);
      expect(addGroupMemberAction).toHaveBeenNthCalledWith(2, "csrf", {
        groupId: "g1",
        userId: BOB.id,
      });
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(screen.getByLabelText("Add member")).toHaveTextContent("Select a user");
      expect(screen.getByRole("button", { name: "Add", exact: true })).toBeDisabled();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    },
  );

  it.each(["returned", "rejected"] as const)(
    "retains roster and add-selection context and retries Remove after a %s failure",
    async (failure) => {
      if (failure === "returned") {
        removeGroupMemberAction.mockResolvedValueOnce({ ok: false, error: "unauthorized" });
      } else {
        removeGroupMemberAction.mockRejectedValueOnce(new Error("private removal diagnostic"));
      }
      render(<GroupMembersClient groupId="g1" members={[ANN]} allUsers={[BOB]} />);
      pickBob();
      fireEvent.click(screen.getByRole("button", { name: "Remove Ann" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(
        failure === "returned"
          ? IDENTITY_ERROR_MESSAGES.permission
          : IDENTITY_ERROR_MESSAGES.generic,
      );
      expect(screen.queryByText("private removal diagnostic")).not.toBeInTheDocument();
      expect(screen.getByText("Ann")).toBeInTheDocument();
      expect(screen.getByLabelText("Add member")).toHaveTextContent("Bob");
      expect(screen.getByRole("button", { name: "Remove Ann" })).toBeEnabled();
      expect(refresh).not.toHaveBeenCalled();
      const retry = deferred();
      removeGroupMemberAction.mockReturnValueOnce(retry.promise);
      fireEvent.click(screen.getByRole("button", { name: "Remove Ann" }));
      expect(screen.getByRole("button", { name: "Remove Ann" })).toBeDisabled();
      expect(screen.getByLabelText("Add member")).toBeDisabled();
      expect(screen.getByLabelText("Add member")).toHaveTextContent("Bob");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      await act(async () => {
        retry.settle({ ok: true, value: true });
        await retry.promise;
      });
      expect(removeGroupMemberAction).toHaveBeenCalledTimes(2);
      expect(removeGroupMemberAction).toHaveBeenNthCalledWith(2, "csrf", {
        groupId: "g1",
        userId: ANN.userId,
      });
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(screen.getByText("Ann")).toBeInTheDocument();
      expect(screen.getByLabelText("Add member")).toHaveTextContent("Bob");
      expect(screen.getByRole("button", { name: "Add", exact: true })).toBeEnabled();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    },
  );

  it("locks the roster and picker against duplicate or competing mutations until acknowledgement", async () => {
    const pending = deferred();
    removeGroupMemberAction.mockReturnValueOnce(pending.promise);
    render(<GroupMembersClient groupId="g1" members={[ANN]} allUsers={[BOB]} />);
    pickBob();
    const remove = screen.getByRole("button", { name: "Remove Ann" });
    fireEvent.click(remove);
    fireEvent.click(remove);
    fireEvent.click(screen.getByRole("button", { name: "Add", exact: true }));
    expect(removeGroupMemberAction).toHaveBeenCalledTimes(1);
    expect(addGroupMemberAction).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Add member")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add", exact: true })).toBeDisabled();
    expect(refresh).not.toHaveBeenCalled();
    await act(async () => {
      pending.settle({ ok: false, error: "unauthorized" });
      await pending.promise;
    });
    expect(screen.getByRole("alert")).toHaveTextContent(IDENTITY_ERROR_MESSAGES.permission);
    expect(screen.getByLabelText("Add member")).toBeEnabled();
    expect(screen.getByLabelText("Add member")).toHaveTextContent("Bob");
    expect(screen.getByRole("button", { name: "Remove Ann" })).toBeEnabled();
  });

  it("does not report an acknowledged Add as a failed mutation when refresh throws", async () => {
    refresh.mockImplementationOnce(() => {
      throw new Error("navigation interrupted");
    });
    render(<GroupMembersClient groupId="g1" members={[ANN]} allUsers={[BOB]} />);
    pickBob();
    fireEvent.click(screen.getByRole("button", { name: "Add", exact: true }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Ann")).toBeInTheDocument();
    expect(screen.getByLabelText("Add member")).toHaveTextContent("Select a user");
    expect(addGroupMemberAction).toHaveBeenCalledTimes(1);
  });

  it.each(["en", "de", "fa"] as const)(
    "offers localized unavailable recovery without roster writes in %s",
    async (locale) => {
      const L = settingsMessagesForLocale(locale);
      const copy = {
        en: {
          error: "Members are unavailable. Try again to reload this group's members.",
          retry: "Try again",
        },
        de: {
          error: "Die Mitglieder konnten nicht geladen werden. Versuchen Sie es erneut.",
          retry: "Erneut versuchen",
        },
        fa: {
          error: "فهرست اعضای این گروه در دسترس نیست. دوباره تلاش کنید.",
          retry: "تلاش دوباره",
        },
      }[locale];
      render(
        <LocaleProvider locale={locale}>
          <GroupMembersUnavailable />
        </LocaleProvider>,
      );
      expect(screen.getByRole("alert")).toHaveTextContent(copy.error);
      expect(screen.getByRole("heading", { name: L._extra.members })).toBeInTheDocument();
      expect(screen.queryByText(L._extra.no_members_yet)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(L._extra.add_member)).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: L._extra.add, exact: true }),
      ).not.toBeInTheDocument();
      expect(document.documentElement.dir).toBe(locale === "fa" ? "rtl" : "ltr");
      fireEvent.click(screen.getByRole("button", { name: copy.retry }));
      await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
      expect(addGroupMemberAction).not.toHaveBeenCalled();
      expect(removeGroupMemberAction).not.toHaveBeenCalled();
    },
  );

  it("retains unavailable recovery if Retry cannot start a refresh", async () => {
    refresh.mockImplementationOnce(() => {
      throw new Error("refresh unavailable");
    });
    render(<GroupMembersUnavailable />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("alert")).toHaveTextContent("Members are unavailable.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
    expect(screen.queryByText("No members yet.")).not.toBeInTheDocument();
    expect(addGroupMemberAction).not.toHaveBeenCalled();
    expect(removeGroupMemberAction).not.toHaveBeenCalled();
  });
});
