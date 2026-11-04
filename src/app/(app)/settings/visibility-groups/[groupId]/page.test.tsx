// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { messagesForLocale } from "@/features/i18n/catalog";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { Locale } from "@/features/i18n/registry";
import { settingsMessagesForLocale } from "@/features/identity/settingsMessages";

type MemberResult =
  | { ok: true; value: { userId: string; name: string }[] }
  | { ok: false; error: string };
type TestActor = { id: string; type: "admin" | "user"; flags: Set<string> };
const mocks = vi.hoisted(() => {
  const initial: { locale: Locale } = { locale: "en" };
  return {
    ...initial,
    refresh: vi.fn(),
    notFound: vi.fn(() => {
      throw new Error("not found");
    }),
    context: vi.fn<() => Promise<{ actor: TestActor | null; db: object }>>(),
    groups: vi.fn<() => Promise<{ id: string; name: string }[]>>(),
    members: vi.fn<() => Promise<MemberResult>>(),
    users: vi.fn<() => Promise<{ id: string; name: string; avatarUrl: string | null }[]>>(),
    add: vi.fn(),
    remove: vi.fn(),
  };
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
  notFound: mocks.notFound,
}));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: ReactNode;
    className?: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@/server/trpc/context", () => ({ createContext: mocks.context }));
vi.mock("@/features/identity/visibility-groups.service", () => ({
  listVisibilityGroups: mocks.groups,
  listGroupMembers: mocks.members,
}));
vi.mock("@/features/identity/users.service", () => ({ listAssignableUsers: mocks.users }));
vi.mock("@/features/identity/settingsMessages.server", () => ({
  getServerSettingsMessages: () => Promise.resolve(settingsMessagesForLocale(mocks.locale)),
}));
vi.mock("@/features/identity/actions/groups", () => ({
  addGroupMemberAction: mocks.add,
  removeGroupMemberAction: mocks.remove,
}));
vi.mock("@/features/i18n/actions", () => ({ saveLocalePreferencesAction: vi.fn() }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));

import GroupDetailPage from "./page";

const GROUP = { id: "g1", name: "Project Atlas" };
const MEMBER = { userId: "u1", name: "Ann" };
const USER = { id: "u2", name: "Bob", avatarUrl: null };

beforeEach(() => {
  mocks.locale = "en";
  mocks.refresh.mockReset();
  mocks.notFound.mockClear();
  mocks.context.mockReset().mockResolvedValue({
    actor: { id: "owner", type: "admin", flags: new Set() },
    db: {},
  });
  mocks.groups.mockReset().mockResolvedValue([GROUP]);
  mocks.members.mockReset().mockResolvedValue({ ok: true, value: [MEMBER] });
  mocks.users.mockReset().mockResolvedValue([USER]);
  mocks.add.mockReset().mockResolvedValue({ ok: true, value: true });
  mocks.remove.mockReset().mockResolvedValue({ ok: true, value: true });
});
afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("lang");
  document.documentElement.removeAttribute("dir");
});

async function pageNode() {
  const content = await GroupDetailPage({ params: Promise.resolve({ groupId: GROUP.id }) });
  return <LocaleProvider locale={mocks.locale}>{content}</LocaleProvider>;
}

function expectGroupContext(locale: Locale = "en") {
  expect(screen.getByRole("heading", { name: GROUP.name })).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: settingsMessagesForLocale(locale).visibilityGroups }),
  ).toHaveAttribute("href", "/settings/visibility-groups");
}

function expectNoRosterWrites(locale: Locale = "en") {
  const L = settingsMessagesForLocale(locale);
  expect(screen.queryByLabelText(L._extra.add_member)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: L._extra.add })).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: L._extra.removeUser("Ann") }),
  ).not.toBeInTheDocument();
  expect(mocks.add).not.toHaveBeenCalled();
  expect(mocks.remove).not.toHaveBeenCalled();
}

describe("Visibility group member reads", () => {
  it("renders a successful roster within its actual group context", async () => {
    render(await pageNode());
    expectGroupContext();
    expect(screen.getByText("Ann")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Ann" })).toBeEnabled();
    expect(screen.getByLabelText("Add member")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders a successfully read empty roster as empty with membership controls", async () => {
    mocks.members.mockResolvedValueOnce({ ok: true, value: [] });
    render(await pageNode());
    expectGroupContext();
    expect(screen.getByText("No members yet.")).toBeInTheDocument();
    expect(screen.getByLabelText("Add member")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it.each(["returned denial", "member rejection", "assignable users rejection"] as const)(
    "keeps unavailable data distinct from no members after %s",
    async (failure) => {
      if (failure === "returned denial") {
        // This is the service's actual failed-Result case: a permission denial, not a DB result.
        mocks.members.mockResolvedValueOnce({ ok: false, error: "permissions.manage required" });
      } else if (failure === "member rejection") {
        mocks.members.mockRejectedValueOnce(new Error("private roster read diagnostic"));
      } else {
        mocks.users.mockRejectedValueOnce(new Error("private assignable-user diagnostic"));
      }
      render(await pageNode());
      expectGroupContext();
      expect(screen.getByRole("alert")).toHaveTextContent(
        settingsMessagesForLocale("en")._extra.visibilityGroupMembersUnavailable,
      );
      expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
      expect(screen.queryByText("No members yet.")).not.toBeInTheDocument();
      expect(screen.queryByText(/private .* diagnostic/)).not.toBeInTheDocument();
      expect(screen.queryByText("Ann")).not.toBeInTheDocument();
      expectNoRosterWrites();
    },
  );

  it("Retry refreshes the real group route without offering mutations against unknown data", async () => {
    mocks.members.mockRejectedValueOnce(new Error("unavailable"));
    render(await pageNode());
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expectGroupContext();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expectNoRosterWrites();
  });

  it("recovers the roster after Retry receives a successful fresh server render", async () => {
    mocks.members.mockRejectedValueOnce(new Error("unavailable"));
    const view = render(await pageNode());
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    // Explicit server rerender witness only; no native navigation or installed DB is implied.
    view.rerender(await pageNode());
    expectGroupContext();
    expect(screen.getByText("Ann")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Ann" })).toBeEnabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it.each(["en", "de", "fa"] as const)(
    "retains group context, localized unavailability and Retry in %s",
    async (locale) => {
      mocks.locale = locale;
      mocks.members.mockRejectedValueOnce(new Error("private member read"));
      render(await pageNode());
      const L = settingsMessagesForLocale(locale);
      expectGroupContext(locale);
      expect(screen.getByRole("alert")).toHaveTextContent(
        L._extra.visibilityGroupMembersUnavailable,
      );
      expect(screen.queryByText(L._extra.no_members_yet)).not.toBeInTheDocument();
      expectNoRosterWrites(locale);
      fireEvent.click(
        screen.getByRole("button", { name: messagesForLocale(locale).boundaries.retry }),
      );
      await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
      expect(document.documentElement.dir).toBe(locale === "fa" ? "rtl" : "ltr");
      expect(mocks.add).not.toHaveBeenCalled();
      expect(mocks.remove).not.toHaveBeenCalled();
    },
  );

  it.each([null, { id: "plain", type: "user" as const, flags: new Set<string>() }])(
    "preserves the existing administrative read gate for actor %s",
    async (actor) => {
      mocks.context.mockResolvedValueOnce({ actor, db: {} });
      render(await pageNode());
      expect(screen.getByText(settingsMessagesForLocale("en").requiresAdmin)).toBeInTheDocument();
      expect(mocks.groups).not.toHaveBeenCalled();
      expect(mocks.members).not.toHaveBeenCalled();
      expect(mocks.users).not.toHaveBeenCalled();
      expectNoRosterWrites();
    },
  );

  it("retains notFound for an unknown group instead of misreporting a member read failure", async () => {
    mocks.groups.mockResolvedValueOnce([]);
    await expect(pageNode()).rejects.toThrow("not found");
    expect(mocks.notFound).toHaveBeenCalledTimes(1);
    expect(mocks.members).not.toHaveBeenCalled();
    expect(mocks.users).not.toHaveBeenCalled();
  });
});
