// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

const onBack = vi.fn();
const invalidateAll = vi.fn();
const invalidateThread = vi.fn();
const inv = () => ({ invalidate: invalidateAll });
// Separate spies: the record timelines read the message-level keys, so a delete has to invalidate
// those and not the retired thread-summary ones.
const invalidateDealMessages = vi.fn();
const invalidateContactMessages = vi.fn();
vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    useUtils: () => ({
      email: {
        inbox: { list: inv(), unreadCount: inv() },
        folders: { sent: inv(), archive: inv() },
        search: inv(),
        thread: { get: { invalidate: invalidateThread } },
        listMessagesForDeal: { invalidate: invalidateDealMessages },
        listMessagesForContact: { invalidate: invalidateContactMessages },
      },
    }),
  },
}));

const reportError = vi.fn();
vi.mock("@/components/shell/ActionErrorProvider", () => ({
  useActionError: () => reportError,
}));

const archiveMock = vi.fn(() => Promise.resolve({ ok: true, value: {} }));
vi.mock("./folderActions", () => ({
  archiveThreadAction: (...a: unknown[]) => archiveMock(...(a as [])),
}));
const trashMock = vi.fn(() => Promise.resolve({ ok: true, value: { threadId: "t1" } }));
vi.mock("./actions", () => ({
  trashThreadAction: (...a: unknown[]) => trashMock(...(a as [])),
}));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));

import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { emailMessagesForLocale } from "./emailMessages";
import { ReaderTopBar } from "./ReaderTopBar";

afterEach(() => {
  cleanup();
  onBack.mockClear();
  reportError.mockClear();
  archiveMock.mockClear();
  trashMock.mockClear();
  trashMock.mockResolvedValue({ ok: true, value: { threadId: "t1" } });
  invalidateAll.mockClear();
  invalidateThread.mockClear();
  invalidateDealMessages.mockClear();
  invalidateContactMessages.mockClear();
});

it("closes the reader with the Back button keyboard activation", async () => {
  const user = userEvent.setup();
  render(<ReaderTopBar threadId="t1" canManage onBack={onBack} />);
  screen.getByRole("button", { name: /back to inbox/i }).focus();
  await user.keyboard("{Enter}");
  expect(onBack).toHaveBeenCalledTimes(1);
  expect(archiveMock).not.toHaveBeenCalled();
  expect(trashMock).not.toHaveBeenCalled();
});

it.each(["fa", "de"] as const)(
  "disables unsupported remote controls while preserving local archive (%s)",
  (locale) => {
    const E = emailMessagesForLocale(locale);
    render(
      <LocaleProvider locale={locale}>
        <ReaderTopBar
          threadId="t1"
          canManage
          onBack={onBack}
          mailCapabilities={{ read: true, send: true, markRead: false, move: false, trash: false }}
        />
      </LocaleProvider>,
    );
    const deleteButton = screen.getByRole("button", { name: E.delete });
    expect(deleteButton).toBeDisabled();
    expect(deleteButton).toHaveAccessibleDescription(E.remoteActions.unavailable);
    expect(screen.getByRole("button", { name: E.archive })).not.toBeDisabled();
  },
);

it("archives the selected conversation and closes the reader on success", async () => {
  render(<ReaderTopBar threadId="t1" canManage onBack={onBack} />);
  screen.getByRole("button", { name: "Archive" }).click();
  await waitFor(() => expect(archiveMock).toHaveBeenCalledWith("csrf", { threadId: "t1" }));
  await waitFor(() => expect(onBack).toHaveBeenCalledTimes(1));
});

it("reports the error and stays put when archiving is denied (no silent no-op)", async () => {
  archiveMock.mockResolvedValueOnce({ ok: false, error: { id: "E_PERM_001" } } as never);
  render(<ReaderTopBar threadId="t1" canManage onBack={onBack} />);
  screen.getByRole("button", { name: "Archive" }).click();
  await waitFor(() => expect(reportError).toHaveBeenCalledWith("E_PERM_001"));
  expect(onBack).not.toHaveBeenCalled();
});

it("deletes to Gmail Trash after confirming, then closes the reader", async () => {
  render(<ReaderTopBar threadId="t1" canManage onBack={onBack} />);
  screen.getByRole("button", { name: "Delete" }).click();
  // Confirm in the AlertDialog (role=alertdialog, its Action button).
  const confirm = await screen.findByRole("button", { name: /move to trash/i });
  confirm.click();
  await waitFor(() => expect(trashMock).toHaveBeenCalledWith("csrf", { threadId: "t1" }));
  await waitFor(() => expect(onBack).toHaveBeenCalledTimes(1));
  expect(invalidateAll).toHaveBeenCalled();
  expect(invalidateThread).toHaveBeenCalledTimes(1);
});

it.each(["en", "de", "fa"] as const)(
  "opens the localized trash confirmation, focuses Cancel, and restores the trigger (%s)",
  async (locale) => {
    const user = userEvent.setup();
    const E = emailMessagesForLocale(locale);
    render(
      <LocaleProvider locale={locale}>
        <ReaderTopBar threadId="t1" canManage onBack={onBack} />
      </LocaleProvider>,
    );
    const trigger = screen.getByRole("button", { name: E.delete });
    trigger.focus();
    await user.keyboard("{Enter}");
    const dialog = await screen.findByRole("alertdialog", { name: E.deleteConfirmTitle });
    expect(dialog).toHaveAccessibleDescription(E.deleteConfirmBody);
    expect(within(dialog).getByRole("button", { name: E.deleteConfirmAction })).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: E.deleteCancel })).toHaveFocus();
    await user.keyboard(locale === "en" ? "{Escape}" : "{Enter}");
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(trashMock).not.toHaveBeenCalled();
  },
);

it("sends one trash action when confirmation is repeated while the request is pending", async () => {
  const user = userEvent.setup();
  trashMock.mockReturnValueOnce(new Promise(() => undefined));
  render(<ReaderTopBar threadId="t1" canManage onBack={onBack} />);
  const trigger = screen.getByRole("button", { name: "Delete" });
  await user.click(trigger);
  const confirm = await screen.findByRole("button", { name: /move to trash/i });
  act(() => {
    confirm.click();
    confirm.click();
  });
  expect(trashMock).toHaveBeenCalledExactlyOnceWith("csrf", { threadId: "t1" });
  expect(trigger).toBeDisabled();
});

it("closes a stale confirmation when the reader moves to another thread", async () => {
  const user = userEvent.setup();
  const { rerender } = render(<ReaderTopBar threadId="t1" canManage onBack={onBack} />);
  await user.click(screen.getByRole("button", { name: "Delete" }));
  expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
  rerender(<ReaderTopBar threadId="t2" canManage onBack={onBack} />);
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(trashMock).not.toHaveBeenCalled();
});

it("refreshes the record timelines so a deleted thread leaves the deal and person pages", async () => {
  render(<ReaderTopBar threadId="t1" canManage onBack={onBack} />);
  screen.getByRole("button", { name: "Delete" }).click();
  (await screen.findByRole("button", { name: /move to trash/i })).click();
  await waitFor(() => expect(invalidateDealMessages).toHaveBeenCalled());
  expect(invalidateContactMessages).toHaveBeenCalled();
});

it("refreshes the record timelines on archive too", async () => {
  render(<ReaderTopBar threadId="t1" canManage onBack={onBack} />);
  screen.getByRole("button", { name: "Archive" }).click();
  await waitFor(() => expect(invalidateDealMessages).toHaveBeenCalled());
  expect(invalidateContactMessages).toHaveBeenCalled();
});

it("surfaces a failed delete and stays put (no silent no-op)", async () => {
  trashMock.mockResolvedValueOnce({ ok: false, error: { id: "E_GMAIL_001" } } as never);
  render(<ReaderTopBar threadId="t1" canManage onBack={onBack} />);
  screen.getByRole("button", { name: "Delete" }).click();
  (await screen.findByRole("button", { name: /move to trash/i })).click();
  await waitFor(() => expect(reportError).toHaveBeenCalledWith("E_GMAIL_001"));
  expect(onBack).not.toHaveBeenCalled();
  expect(invalidateThread).not.toHaveBeenCalled();
});

it("groups Archive and Delete together on the left, not pushed to the far right (B3)", () => {
  render(<ReaderTopBar threadId="t1" canManage onBack={onBack} />);
  const archive = screen.getByRole("button", { name: "Archive" });
  const del = screen.getByRole("button", { name: "Delete" });
  // PD groups the reader actions top-left; WD previously pushed Archive right with ml-auto.
  expect(archive.className).not.toMatch(/ml-auto/);
  // Archive + Delete share one action group wrapper (grouped per PD), distinct from the Back button.
  const group = archive.closest("[data-reader-actions-group]");
  expect(group).not.toBeNull();
  expect(del.closest("[data-reader-actions-group]")).toBe(group);
  expect(
    screen.getByRole("button", { name: /back to inbox/i }).closest("[data-reader-actions-group]"),
  ).toBeNull();
});

it("hides Archive and Delete for a non-owner (canManage false)", () => {
  render(<ReaderTopBar threadId="t1" canManage={false} onBack={onBack} />);
  expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
});
