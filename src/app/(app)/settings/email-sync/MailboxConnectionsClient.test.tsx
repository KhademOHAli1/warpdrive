// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { authScreensMessagesForLocale } from "@/features/auth/authScreensMessages";
import type { SecurityStatus } from "@/features/auth/better/contracts";
import { mailboxConnectionMessages } from "@/features/email/connections/messages";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { MailboxConnectionsClient } from "./MailboxConnectionsClient";

vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "fresh-csrf" }));
vi.mock("@/features/email/actions", () => ({ connectGmailStart: vi.fn() }));
vi.mock("@/features/auth/better/client", () => ({
  authClient: { twoFactor: { verifyTotp: vi.fn() }, signIn: { passkey: vi.fn(), social: vi.fn() } },
}));
const capabilities = { read: true, send: true, markRead: true, move: false, trash: false };
const mailbox = {
  id: "account",
  emailAddress: "sales@example.com",
  provider: "imap_smtp",
  status: "connected",
  isDefault: true,
  lastSyncAtIso: null,
  capabilities,
};
const status: SecurityStatus = {
  authenticated: true,
  user: { id: "user", name: "Operator", email: "operator@example.com", isAdmin: false },
  emailVerified: true,
  hasPassword: true,
  twoFactorEnabled: false,
  needsMfa: false,
  needsEnrollment: false,
  fresh: false,
  authMethod: "password",
  policy: { requireMfaForAll: false, idleMinutes: 30, absoluteHours: 168, freshMinutes: 5 },
  accounts: [],
  passkeys: [],
  sessions: [],
  recoveryCodesAvailable: false,
  audit: [],
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

for (const locale of ["fa", "de"] as const) {
  it(`completes native identity confirmation then retries mailbox setup and refreshes the list in ${locale}`, async () => {
    let fresh = false;
    const calls: { path: string; body?: unknown }[] = [];
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      await Promise.resolve();
      const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ path, body });
      if (path === "/api/auth-workflows/status")
        return Response.json({ ok: true, data: { ...status, fresh } });
      if (path === "/api/auth-workflows/providers")
        return Response.json({
          ok: true,
          data: { providers: [], emailPassword: true, passkeys: true },
        });
      if (path === "/api/auth-workflows/security") {
        fresh = true;
        return Response.json({ ok: true, data: {} });
      }
      if (path === "/api/mail-connections/check")
        return Response.json(
          fresh
            ? {
                ok: true,
                value: {
                  checkId: "proof",
                  mailboxAddress: "sales@example.com",
                  capabilities,
                  folders: [{ path: "INBOX", name: "Inbox", role: "inbox", readOnly: false }],
                },
              }
            : { ok: false, error: "fresh_auth_required" },
          { status: fresh ? 200 : 403 },
        );
      if (path === "/api/mail-connections/save") return Response.json({ ok: true, value: mailbox });
      if (path === "/api/mail-connections/list")
        return Response.json({ ok: true, value: [mailbox] });
      throw new Error("Unexpected frontend request");
    });
    vi.stubGlobal("fetch", request);
    const L = mailboxConnectionMessages(locale);
    const A = authScreensMessagesForLocale(locale).flow;
    render(
      <LocaleProvider locale={locale}>
        <MailboxConnectionsClient initialMailboxes={[]} gmailAvailable={false} />
      </LocaleProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: L.add }));
    fireEvent.click(screen.getByRole("button", { name: L.independent }));
    for (const [label, value] of [
      [L.email, "sales@example.com"],
      [L.imapHost, "imap.example.com"],
      [L.smtpHost, "smtp.example.com"],
      [L.imapUser, "sales@example.com"],
      [L.smtpUser, "sales@example.com"],
      [L.imapPassword, "initial-imap"],
      [L.smtpPassword, "initial-smtp"],
    ])
      fireEvent.change(screen.getByLabelText(label!), { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: L.check }));
    fireEvent.click(await screen.findByRole("button", { name: L.confirmIdentity }));
    const identityDialog = await screen.findByRole("dialog", { name: A.confirmIdentity });
    const passwordField = await within(identityDialog).findByLabelText(A.currentPassword);
    fireEvent.change(passwordField, { target: { value: "crm-confirmation-password" } });
    fireEvent.click(within(identityDialog).getByRole("button", { name: A.confirmIdentity }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: A.confirmIdentity })).not.toBeInTheDocument(),
    );
    expect(screen.getByLabelText(L.imapPassword)).toHaveValue("");
    expect(screen.getByLabelText(L.smtpPassword)).toHaveValue("");
    fireEvent.change(screen.getByLabelText(L.imapPassword), { target: { value: "fresh-imap" } });
    fireEvent.change(screen.getByLabelText(L.smtpPassword), { target: { value: "fresh-smtp" } });
    fireEvent.click(screen.getByRole("button", { name: L.check }));
    fireEvent.click(await screen.findByRole("button", { name: L.connect }));
    await screen.findByText("sales@example.com");
    expect(calls.filter((call) => call.path === "/api/mail-connections/check")).toHaveLength(2);
    expect(calls.find((call) => call.path === "/api/auth-workflows/security")?.body).toEqual({
      action: "reauthenticate",
      password: "crm-confirmation-password",
    });
    expect(calls.find((call) => call.path === "/api/mail-connections/save")?.body).toEqual({
      checkId: "proof",
      folderPaths: ["INBOX"],
      historyDays: 90,
      isDefault: true,
      sentCopyMode: "crm_only",
    });
    expect(request.mock.calls.every(([, init]) => init?.credentials === "same-origin")).toBe(true);
  });
}
