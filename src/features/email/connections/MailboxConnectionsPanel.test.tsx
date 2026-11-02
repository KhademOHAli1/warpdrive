// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { MailboxConnectionsPanel } from "./MailboxConnectionsPanel";
import type { MailboxConnectionActions, MailboxConnectionView } from "./types";

const capabilities = { read: true, send: true, markRead: true, move: true, trash: false };
const mailbox: MailboxConnectionView = {
  id: "mailbox-1",
  provider: "imap_smtp",
  emailAddress: "sales@example.com",
  status: "connected",
  isDefault: true,
  lastSyncAtIso: "2026-10-31T10:00:00Z",
  capabilities,
};
const copy = {
  fa: {
    add: "افزودن صندوق ایمیل",
    independent: "ایمیل سازمانی یا شخصی",
    email: "نشانی ایمیل",
    imapHost: "سرور دریافت ایمیل",
    smtpHost: "سرور ارسال ایمیل",
    imapUser: "نام کاربری دریافت",
    smtpUser: "نام کاربری ارسال",
    imapPassword: "گذرواژه دریافت",
    smtpPassword: "گذرواژه ارسال",
    check: "بررسی اتصال",
    save: "اتصال صندوق",
    inbox: "صندوق ورودی",
    sent: "ارسال‌شده‌ها",
    cancel: "انصراف",
    manage: "مدیریت صندوق",
    pause: "توقف همگام‌سازی",
    disconnect: "قطع اتصال",
    confirm: "قطع اتصال صندوق",
    default: "فرستنده پیش‌فرض",
    error: "نام کاربری یا گذرواژه پذیرفته نشد. اطلاعات ورود را بررسی کنید و دوباره تلاش کنید.",
    empty: "صندوق ایمیلی متصل نشده است.",
  },
  de: {
    add: "Postfach hinzufügen",
    independent: "Eigenes E-Mail-Postfach",
    email: "E-Mail-Adresse",
    imapHost: "Server für eingehende E-Mails",
    smtpHost: "Server für ausgehende E-Mails",
    imapUser: "Benutzername für Empfang",
    smtpUser: "Benutzername für Versand",
    imapPassword: "Passwort für Empfang",
    smtpPassword: "Passwort für Versand",
    check: "Verbindung prüfen",
    save: "Postfach verbinden",
    inbox: "Posteingang",
    sent: "Gesendet",
    cancel: "Abbrechen",
    manage: "Postfach verwalten",
    pause: "Synchronisierung pausieren",
    disconnect: "Verbindung trennen",
    confirm: "Postfachverbindung trennen",
    default: "Standardabsender",
    error:
      "Benutzername oder Passwort wurde nicht akzeptiert. Prüfen Sie die Zugangsdaten und versuchen Sie es erneut.",
    empty: "Noch kein Postfach verbunden.",
  },
} as const;

function fixture() {
  const actions: MailboxConnectionActions = {
    check: vi.fn().mockResolvedValue({
      ok: true,
      value: {
        checkId: "checked-connection",
        mailboxAddress: "sales@example.com",
        folders: [
          { path: "INBOX", name: "Inbox", role: "inbox", readOnly: false },
          { path: "Sent", name: "Sent", role: "sent", readOnly: false },
          { path: "Archive", name: "Archive", role: "other", readOnly: true },
        ],
        capabilities,
      },
    }),
    save: vi.fn().mockResolvedValue({ ok: true, value: mailbox }),
    mutate: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    connectGmail: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
  };
  return { actions, changed: vi.fn() };
}

function enterCredentials(locale: keyof typeof copy) {
  const L = copy[locale];
  fireEvent.change(screen.getByLabelText(L.email), { target: { value: "sales@example.com" } });
  fireEvent.change(screen.getByLabelText(L.imapHost), { target: { value: "imap.example.com" } });
  fireEvent.change(screen.getByLabelText(L.smtpHost), { target: { value: "smtp.example.com" } });
  fireEvent.change(screen.getByLabelText(L.imapUser), { target: { value: "sales@example.com" } });
  fireEvent.change(screen.getByLabelText(L.smtpUser), { target: { value: "sales@example.com" } });
  fireEvent.change(screen.getByLabelText(L.imapPassword), {
    target: { value: "private-imap-fixture" },
  });
  fireEvent.change(screen.getByLabelText(L.smtpPassword), {
    target: { value: "private-smtp-fixture" },
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

for (const locale of ["fa", "de"] as const) {
  describe(locale, () => {
    it("checks credentials before saving a selected folder and history scope without resending secrets", async () => {
      const { actions, changed } = fixture();
      const L = copy[locale];
      render(
        <LocaleProvider locale={locale}>
          <MailboxConnectionsPanel mailboxes={[]} actions={actions} onChanged={changed} />
        </LocaleProvider>,
      );
      expect(screen.getByText(L.empty)).toBeVisible();
      fireEvent.click(screen.getByRole("button", { name: L.add }));
      fireEvent.click(screen.getByRole("button", { name: L.independent }));
      enterCredentials(locale);
      expect(actions.save).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: L.check }));
      await screen.findByRole("button", { name: L.save });
      expect(screen.queryByLabelText(L.imapPassword)).not.toBeInTheDocument();
      expect(screen.getByRole("checkbox", { name: L.inbox })).toBeChecked();
      expect(
        screen.getByLabelText(locale === "fa" ? "بازه زمانی (روز)" : "Zeitraum in Tagen"),
      ).toHaveValue(locale === "fa" ? "۹۰" : "90");
      expect(screen.getByRole("checkbox", { name: L.sent })).toBeChecked();
      fireEvent.click(screen.getByRole("checkbox", { name: L.sent }));
      fireEvent.click(screen.getByRole("button", { name: L.save }));
      await waitFor(() => expect(changed).toHaveBeenCalledOnce());
      expect(actions.save).toHaveBeenCalledWith(
        {
          checkId: "checked-connection",
          folderPaths: ["INBOX"],
          historyDays: 90,
          isDefault: true,
          sentCopyMode: "crm_only",
        },
        expect.any(AbortSignal),
      );
      expect(JSON.stringify(vi.mocked(actions.save).mock.calls)).not.toContain(
        "private-imap-fixture",
      );
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(screen.getByRole("button", { name: L.add })).toHaveFocus();
    });

    it("shows localized authentication recovery without exposing provider diagnostics", async () => {
      const { actions } = fixture();
      vi.mocked(actions.check).mockResolvedValueOnce({ ok: false, error: "authentication" });
      const L = copy[locale];
      render(
        <LocaleProvider locale={locale}>
          <MailboxConnectionsPanel mailboxes={[]} actions={actions} />
        </LocaleProvider>,
      );
      fireEvent.click(screen.getByRole("button", { name: L.add }));
      fireEvent.click(screen.getByRole("button", { name: L.independent }));
      enterCredentials(locale);
      fireEvent.click(screen.getByRole("button", { name: L.check }));
      expect(await screen.findByRole("alert")).toHaveTextContent(L.error);
      expect(screen.getByLabelText(L.email)).toHaveValue("sales@example.com");
      fireEvent.click(screen.getByRole("button", { name: L.check }));
      await screen.findByRole("button", { name: L.save });
      expect(actions.check).toHaveBeenCalledTimes(2);
    });

    it("unmounts secrets on dismissal and cancels an unfinished credential check", async () => {
      const { actions } = fixture();
      let checkedSignal: AbortSignal | undefined;
      vi.mocked(actions.check).mockImplementation((_input, signal) => {
        checkedSignal = signal;
        return new Promise(() => undefined);
      });
      const L = copy[locale];
      render(
        <LocaleProvider locale={locale}>
          <MailboxConnectionsPanel mailboxes={[]} actions={actions} />
        </LocaleProvider>,
      );
      fireEvent.click(screen.getByRole("button", { name: L.add }));
      fireEvent.click(screen.getByRole("button", { name: L.independent }));
      enterCredentials(locale);
      fireEvent.click(screen.getByRole("button", { name: L.check }));
      fireEvent.click(screen.getByRole("button", { name: L.cancel }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(checkedSignal?.aborted).toBe(true);
      fireEvent.click(screen.getByRole("button", { name: L.add }));
      fireEvent.click(screen.getByRole("button", { name: L.independent }));
      expect(screen.getByLabelText(L.imapPassword)).toHaveValue("");
      expect(screen.getByLabelText(L.smtpPassword)).toHaveValue("");
    });

    it("keeps management actions separate from the mailbox summary and confirms disconnect", async () => {
      const { actions, changed } = fixture();
      const L = copy[locale];
      render(
        <LocaleProvider locale={locale}>
          <MailboxConnectionsPanel mailboxes={[mailbox]} actions={actions} onChanged={changed} />
        </LocaleProvider>,
      );
      expect(screen.getByText(L.default)).toBeVisible();
      expect(screen.getByText(mailbox.emailAddress)).toHaveAttribute("dir", "ltr");
      expect(screen.queryByRole("button", { name: L.disconnect })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: L.manage }));
      const dialog = screen.getByRole("dialog", { name: L.manage });
      fireEvent.click(within(dialog).getByRole("button", { name: L.pause }));
      await waitFor(() =>
        expect(actions.mutate).toHaveBeenCalledWith("mailbox-1", "pause", expect.any(AbortSignal)),
      );
      expect(changed).toHaveBeenCalledOnce();
      fireEvent.click(within(dialog).getByRole("button", { name: L.disconnect }));
      const confirm = screen.getByRole("alertdialog", { name: L.confirm });
      expect(actions.mutate).toHaveBeenCalledTimes(1);
      fireEvent.click(within(confirm).getByRole("button", { name: L.disconnect }));
      await waitFor(() =>
        expect(actions.mutate).toHaveBeenCalledWith(
          "mailbox-1",
          "disconnect",
          expect.any(AbortSignal),
        ),
      );
    });
  });
}
