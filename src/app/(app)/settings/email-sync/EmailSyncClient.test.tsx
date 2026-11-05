// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const connectGmailStart = vi.fn();
const disconnectMailboxAction = vi.fn();
const refresh = vi.fn();

vi.mock("@/features/email/actions", () => ({
  connectGmailStart: () => connectGmailStart(),
  disconnectMailboxAction: (csrf: string | null, input: unknown) =>
    disconnectMailboxAction(csrf, input),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf-token" }));

import { EmailSyncClient, type MailboxView } from "@/app/(app)/settings/email-sync/EmailSyncClient";
import { mailboxConnectionMessages } from "@/features/email/connections/messages";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { settingsMessagesForLocale } from "@/features/identity/settingsMessages";

const originalLocation = window.location;

const connected: MailboxView = {
  id: "acc-1",
  emailAddress: "rep@example.com",
  status: "connected",
  lastSyncAtIso: "2026-07-01T10:00:00.000Z",
};

beforeEach(() => {
  connectGmailStart.mockReset();
  disconnectMailboxAction.mockReset();
  refresh.mockReset();
  Object.defineProperty(window, "location", { configurable: true, value: { href: "" } });
});
afterEach(() => {
  cleanup();
  Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
});

describe("EmailSyncClient", () => {
  it("shows Connect when no mailbox is linked and redirects to the consent URL", async () => {
    connectGmailStart.mockResolvedValue({
      url: "https://accounts.google.com/o/oauth2/v2/auth?x=1",
    });
    render(<EmailSyncClient mailbox={null} />);
    expect(screen.getByText("No mailbox is connected yet.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Connect Gmail" }));
    await waitFor(() =>
      expect(window.location.href).toBe("https://accounts.google.com/o/oauth2/v2/auth?x=1"),
    );
    expect(connectGmailStart).toHaveBeenCalledTimes(1);
  });

  it("shows the connected address, last sync, and a Disconnect button when connected", () => {
    render(<EmailSyncClient mailbox={connected} />);
    expect(screen.getByText("Connected as rep@example.com")).toBeInTheDocument();
    expect(screen.getByText(/Last synced/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeInTheDocument();
  });

  it.each(["en", "de", "fa"] as const)(
    "requires confirmation and preserves cancellation before disconnect (%s)",
    async (locale) => {
      const copy = mailboxConnectionMessages(locale);
      disconnectMailboxAction.mockResolvedValue({ ok: true, value: { disconnected: true } });
      render(
        <LocaleProvider locale={locale}>
          <EmailSyncClient mailbox={connected} />
        </LocaleProvider>,
      );
      fireEvent.click(screen.getByRole("button"));
      const dialog = screen.getByRole("alertdialog", { name: copy.disconnectTitle });
      expect(disconnectMailboxAction).not.toHaveBeenCalled();
      expect(dialog).toHaveTextContent(copy.disconnectDescription);
      expect(dialog).toHaveTextContent(copy.disconnectQueued);
      expect(dialog).toHaveTextContent(copy.disconnectGoogle);
      expect(dialog).not.toHaveTextContent(copy.disconnectManual);
      fireEvent.click(within(dialog).getByRole("button", { name: copy.cancel }));
      expect(disconnectMailboxAction).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button"));
      fireEvent.click(
        within(screen.getByRole("alertdialog")).getByRole("button", { name: copy.disconnect }),
      );
      await waitFor(() =>
        expect(disconnectMailboxAction).toHaveBeenCalledWith("csrf-token", { accountId: "acc-1" }),
      );
      expect(disconnectMailboxAction).toHaveBeenCalledTimes(1);
      expect(refresh).toHaveBeenCalledTimes(1);
    },
  );

  it("does not disconnect another mailbox if the target changes while confirmation is open", () => {
    disconnectMailboxAction.mockResolvedValue({ ok: true, value: { disconnected: true } });
    const { rerender } = render(<EmailSyncClient mailbox={connected} />);
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    rerender(
      <EmailSyncClient
        mailbox={{ ...connected, id: "acc-2", emailAddress: "other@example.com" }}
      />,
    );
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Disconnect" }),
    );
    expect(disconnectMailboxAction).not.toHaveBeenCalled();
  });

  it("restores an actionable control after a disconnect request rejects", async () => {
    disconnectMailboxAction.mockRejectedValue(new Error("synthetic transport failure"));
    render(<EmailSyncClient mailbox={connected} />);
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Disconnect" }),
    );
    await waitFor(() => expect(screen.getByRole("alert")).toBeVisible());
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeEnabled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it.each(["en", "de", "fa"] as const)(
    "distinguishes Gmail freshness, stale sync, authorization failure, and pause in %s",
    (locale) => {
      const copy = mailboxConnectionMessages(locale);
      const settings = settingsMessagesForLocale(locale)._emailSync;
      const lastCheckedAtIso = new Date().toISOString();
      const staleSync = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString();
      const recentSync = new Date(Date.now() - 60 * 1000).toISOString();
      const view = (mailbox: MailboxView) => (
        <LocaleProvider locale={locale}>
          <EmailSyncClient mailbox={mailbox} />
        </LocaleProvider>
      );
      const { container, rerender } = render(
        view({ ...connected, lastSyncAtIso: null, lastCheckedAtIso: null }),
      );
      expect(screen.getByText(settings.neverSynced)).toBeVisible();
      expect(screen.getByText(copy.neverChecked)).toBeVisible();
      expect(container.querySelectorAll("time")).toHaveLength(0);

      const healthy = { ...connected, lastSyncAtIso: recentSync, lastCheckedAtIso };
      rerender(view(healthy));
      expect(container.querySelector('[data-health="syncing"]')).toBeInTheDocument();
      const stale = { ...healthy, lastSyncAtIso: staleSync };
      rerender(view(stale));
      expect(screen.getByText(settings.statusStalled)).toBeVisible();
      expect(Array.from(container.querySelectorAll("time"), (time) => time.dateTime)).toEqual([
        staleSync,
        lastCheckedAtIso,
      ]);

      rerender(view({ ...stale, status: "disconnected", errorCode: "authentication" }));
      expect(screen.getByText(copy.gmailAuthorizationRequired)).toBeVisible();
      expect(screen.getByText(copy.gmailAuthorizationHint)).toBeVisible();
      expect(screen.getByRole("button", { name: settings.reconnect })).toBeEnabled();
      expect(screen.queryByText(settings.statusStalled)).not.toBeInTheDocument();
      expect(screen.queryByText(/E_GMAIL_002/)).not.toBeInTheDocument();

      rerender(view({ ...stale, paused: true }));
      expect(screen.getByText(copy.paused)).toBeVisible();
      expect(screen.queryByText(settings.statusStalled)).not.toBeInTheDocument();
    },
  );

  it("fills the disconnected status dot from a token so it shows on a dark card", () => {
    const { container } = render(<EmailSyncClient mailbox={null} />);
    const dot = container.querySelector('[data-status="none"]');
    expect(dot).toHaveClass("bg-muted-foreground/40");
    expect(dot?.className).not.toMatch(/-gray-/);
  });
});
