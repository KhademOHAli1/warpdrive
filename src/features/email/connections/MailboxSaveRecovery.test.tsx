// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { Locale } from "@/features/i18n/registry";
import { MailboxScopeForm } from "./MailboxScopeForm";
import { mailboxConnectionMessages } from "./messages";
import type { MailboxConnectionActions, MailboxConnectionView } from "./types";

const capabilities = { read: true, send: true, markRead: true, move: false, trash: false };
const current: MailboxConnectionView = {
  id: "original-account",
  provider: "imap_smtp",
  emailAddress: "owner@example.test",
  status: "connected",
  isDefault: true,
  lastSyncAtIso: null,
  historyDays: 7,
  folderPaths: ["Archive"],
  capabilities,
};
function setup(options: { locale?: Locale; existing?: MailboxConnectionView } = {}) {
  const list = vi
    .fn<NonNullable<MailboxConnectionActions["list"]>>()
    .mockResolvedValue({ ok: true, value: [current] });
  const actions: MailboxConnectionActions = {
    list,
    check: vi.fn(),
    save: vi.fn().mockResolvedValue({ ok: false, error: "network" }),
    mutate: vi.fn(),
  };
  const onConnected = vi.fn();
  const onReviewSavedSettings = vi.fn();
  const locale = options.locale ?? "en";
  render(
    <LocaleProvider locale={locale}>
      <MailboxScopeForm
        actions={actions}
        checked={{
          checkId: "single-use-proof",
          mailboxAddress: "owner@example.test",
          folders: [{ path: "INBOX", name: "Inbox", role: "inbox", readOnly: false }],
          capabilities,
        }}
        initialSettings={options.existing}
        defaultSender
        onConnected={onConnected}
        onCheckAgain={vi.fn()}
        onReviewSavedSettings={onReviewSavedSettings}
      />
    </LocaleProvider>,
  );
  return {
    actions,
    list,
    onConnected,
    onReviewSavedSettings,
    L: mailboxConnectionMessages(locale),
  };
}
afterEach(cleanup);

it.each(["en", "de", "fa"] as const)(
  "reloads current owned settings after a lost save response in %s without claiming intent acceptance",
  async (locale) => {
    const { actions, onConnected, onReviewSavedSettings, L } = setup({ locale });
    fireEvent.change(screen.getByLabelText(L.historyDays), { target: { value: "365" } });
    fireEvent.click(screen.getByRole("button", { name: L.connect }));
    await screen.findByText(L.saveUncertain);
    expect(screen.getByRole("button", { name: L.connect })).toBeDisabled();
    const form = screen.getByLabelText(L.historyDays).closest("form");
    if (form === null) throw new Error("Missing mailbox settings form");
    fireEvent.submit(form);
    expect(actions.save).toHaveBeenCalledTimes(1);
    expect(actions.list).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: L.reloadSavedSettings }));
    const recovery = screen.getByRole("region", { name: L.reloadSavedSettings });
    await within(recovery).findByText(L.savedSettingsUnconfirmed);
    expect(within(recovery).getByText("Archive")).toBeVisible();
    expect(within(recovery).getByText(L.neverSynced)).toBeVisible();
    expect(actions.save).toHaveBeenCalledTimes(1);
    expect(onConnected).not.toHaveBeenCalled();
    expect(onReviewSavedSettings).not.toHaveBeenCalled();
    fireEvent.click(within(recovery).getByRole("button", { name: L.reviewSavedSettings }));
    expect(onReviewSavedSettings).toHaveBeenCalledOnce();
    expect(onConnected).not.toHaveBeenCalled();
  },
);

it("keeps an existing-account save uncertain when only another account with the same address is visible", async () => {
  const existing = { ...current, folderPaths: ["INBOX"] };
  const { actions, list, onConnected, L } = setup({ existing });
  list.mockResolvedValue({ ok: true, value: [{ ...current, id: "different-account" }] });
  fireEvent.click(screen.getByRole("button", { name: L.connect }));
  await screen.findByText(L.saveUncertain);
  fireEvent.click(screen.getByRole("button", { name: L.reloadSavedSettings }));
  await screen.findByText(L.savedMailboxNotFound);
  expect(screen.queryByText(L.savedSettingsUnconfirmed)).not.toBeInTheDocument();
  expect(onConnected).not.toHaveBeenCalled();
  expect(actions.save).toHaveBeenCalledTimes(1);
});

it("does not treat another provider or ambiguous list matches as a recovered mailbox", async () => {
  const { actions, list, L } = setup();
  list.mockResolvedValueOnce({ ok: true, value: [{ ...current, provider: "gmail" }] });
  fireEvent.click(screen.getByRole("button", { name: L.connect }));
  await screen.findByText(L.saveUncertain);
  fireEvent.click(screen.getByRole("button", { name: L.reloadSavedSettings }));
  await screen.findByText(L.savedMailboxNotFound);
  list.mockResolvedValueOnce({ ok: true, value: [current, { ...current, id: "another-account" }] });
  fireEvent.click(screen.getByRole("button", { name: L.reloadSavedSettings }));
  await waitFor(() => expect(actions.list).toHaveBeenCalledTimes(2));
  expect(screen.getByText(L.savedMailboxNotFound)).toBeVisible();
  expect(screen.queryByText(L.savedSettingsUnconfirmed)).not.toBeInTheDocument();
});

it("does not turn a failed status reread into save success or automatic proof replay", async () => {
  const { actions, list, onConnected, L } = setup();
  list.mockResolvedValue({ ok: false, error: "permission" });
  fireEvent.click(screen.getByRole("button", { name: L.connect }));
  await screen.findByText(L.saveUncertain);
  fireEvent.click(screen.getByRole("button", { name: L.reloadSavedSettings }));
  await within(screen.getByRole("region", { name: L.reloadSavedSettings })).findByText(
    L.errors.permission,
  );
  expect(onConnected).not.toHaveBeenCalled();
  expect(actions.save).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: L.connect })).toBeDisabled();
});

it("keeps a definitely rejected form editable without inventing an uncertain saved connection", async () => {
  const { actions, L } = setup();
  vi.mocked(actions.save).mockResolvedValue({ ok: false, error: "invalid_input" });
  fireEvent.click(screen.getByRole("button", { name: L.connect }));
  await screen.findByText(L.errors.invalid_input);
  expect(screen.queryByText(L.saveUncertain)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: L.connect })).toBeEnabled();
  expect(actions.list).not.toHaveBeenCalled();
});
