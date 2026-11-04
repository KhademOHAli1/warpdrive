// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MailboxManagement } from "@/features/email/connections/MailboxManagement";
import { mailboxConnectionMessages } from "@/features/email/connections/messages";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { MailboxConnectionActions, MailboxConnectionView } from "./types";

afterEach(cleanup);
const base: MailboxConnectionView = {
  id: "mailbox-1",
  provider: "gmail",
  emailAddress: "rep@example.com",
  status: "disconnected",
  isDefault: false,
  lastSyncAtIso: null,
  capabilities: { read: true, send: true, markRead: true, move: true, trash: false },
};
const actions: MailboxConnectionActions = {
  check: vi.fn(),
  save: vi.fn(),
  mutate: vi.fn(),
};
function show(mailbox: MailboxConnectionView, locale: "en" | "de" | "fa") {
  return render(
    <LocaleProvider locale={locale}>
      <MailboxManagement
        mailbox={mailbox}
        actions={actions}
        onChanged={vi.fn()}
        onReconnect={vi.fn()}
        onDisconnected={vi.fn()}
        reconnectAvailable
      />
    </LocaleProvider>,
  );
}
for (const locale of ["en", "de", "fa"] as const) {
  describe(`disconnect provider status (${locale})`, () => {
    it("shows Google manual revocation guidance instead of password instructions", () => {
      const copy = mailboxConnectionMessages(locale);
      show({ ...base, remoteRevocationStatus: "manual" }, locale);
      expect(screen.getByText(copy.disconnectGoogleManual)).toBeVisible();
      expect(screen.queryByText(copy.disconnectManual)).not.toBeInTheDocument();
    });
    it("keeps independent mailbox password guidance", () => {
      const copy = mailboxConnectionMessages(locale);
      show({ ...base, provider: "imap_smtp", remoteRevocationStatus: "manual" }, locale);
      expect(screen.getByText(copy.disconnectManual)).toBeVisible();
      expect(screen.queryByText(copy.disconnectGoogleManual)).not.toBeInTheDocument();
    });
    it("preserves pending revocation separately from local disconnection", () => {
      const copy = mailboxConnectionMessages(locale);
      show({ ...base, remoteRevocationStatus: "pending" }, locale);
      expect(screen.getByText(copy.disconnectPending)).toBeVisible();
      expect(screen.queryByText(copy.disconnectComplete)).not.toBeInTheDocument();
    });
    it("preserves confirmed revocation as a separate state", () => {
      const copy = mailboxConnectionMessages(locale);
      show({ ...base, remoteRevocationStatus: "complete" }, locale);
      expect(screen.getByText(copy.disconnectComplete)).toBeVisible();
      expect(screen.queryByText(copy.disconnectPending)).not.toBeInTheDocument();
    });
  });
}
