// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { MailboxConnectionsPanel } from "./MailboxConnectionsPanel";
import { MailboxScopeForm } from "./MailboxScopeForm";
import type {
  CheckedMailboxConnection,
  MailboxConnectionActions,
  MailboxConnectionView,
} from "./types";

const capabilities = { read: true, send: true, markRead: false, move: false, trash: false };
const checked: CheckedMailboxConnection = {
  checkId: "proof",
  mailboxAddress: "sales@example.com",
  capabilities,
  folders: [
    { path: "INBOX", name: "Inbox", role: "inbox", readOnly: false },
    { path: "Sent", name: "Sent", role: "sent", readOnly: null },
    { path: "ReadOnly", name: "ReadOnly", role: "other", readOnly: true },
  ],
};
const mailbox: MailboxConnectionView = {
  id: "account",
  provider: "imap_smtp",
  emailAddress: "sales@example.com",
  status: "connected",
  isDefault: true,
  lastSyncAtIso: null,
  capabilities,
};
function actions(): MailboxConnectionActions {
  return {
    check: vi.fn().mockResolvedValue({ ok: true, value: checked }),
    save: vi.fn().mockResolvedValue({ ok: true, value: mailbox }),
    mutate: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
  };
}
afterEach(cleanup);
for (const [locale, labels] of [
  [
    "fa",
    {
      crm: "نسخه CRM، بدون افزودن نسخه روی سرور",
      append: "افزودن نسخه در پوشه ارسال‌شده‌های سرور",
      folder: "پوشه نسخه ارسالی روی سرور",
      save: "اتصال صندوق",
    },
  ],
  [
    "de",
    {
      crm: "CRM-Kopie, keine zusätzliche Serverkopie",
      append: "Zusätzliche Kopie im Gesendet-Ordner",
      folder: "Ordner für die Serverkopie",
      save: "Postfach verbinden",
    },
  ],
] as const) {
  it(`defaults to CRM-only copies without assuming server autosave in ${locale}`, async () => {
    const api = actions();
    render(
      <LocaleProvider locale={locale}>
        <MailboxScopeForm
          checked={checked}
          actions={api}
          defaultSender
          onConnected={vi.fn()}
          onCheckAgain={vi.fn()}
        />
      </LocaleProvider>,
    );
    expect(screen.getByRole("radio", { name: labels.crm })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: labels.save }));
    await waitFor(() =>
      expect(api.save).toHaveBeenCalledWith(
        expect.objectContaining({ sentCopyMode: "crm_only" }),
        expect.any(AbortSignal),
      ),
    );
  });
  it(`requires explicit server-copy selection and accepts a not-yet-probed Sent folder in ${locale}`, async () => {
    const api = actions();
    render(
      <LocaleProvider locale={locale}>
        <MailboxScopeForm
          checked={checked}
          actions={api}
          defaultSender
          onConnected={vi.fn()}
          onCheckAgain={vi.fn()}
        />
      </LocaleProvider>,
    );
    fireEvent.click(screen.getByRole("radio", { name: labels.append }));
    const folder = screen.getByRole("combobox", { name: labels.folder });
    fireEvent.keyDown(folder, { key: "ArrowDown" });
    expect(screen.queryByRole("option", { name: "ReadOnly" })).not.toBeInTheDocument();
    fireEvent.keyDown(folder, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: labels.save }));
    await waitFor(() =>
      expect(api.save).toHaveBeenCalledWith(
        expect.objectContaining({ sentCopyMode: "append", sentFolderPath: "Sent" }),
        expect.any(AbortSignal),
      ),
    );
  });
}

it("blocks server-copy mode when every folder is known readonly", () => {
  const api = actions();
  render(
    <LocaleProvider locale="de">
      <MailboxScopeForm
        checked={{ ...checked, folders: [{ ...checked.folders[0]!, readOnly: true }] }}
        actions={api}
        defaultSender
        onConnected={vi.fn()}
        onCheckAgain={vi.fn()}
      />
    </LocaleProvider>,
  );
  fireEvent.click(screen.getByRole("radio", { name: "Zusätzliche Kopie im Gesendet-Ordner" }));
  fireEvent.click(screen.getByRole("button", { name: "Postfach verbinden" }));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Wählen Sie einen Ordner aus, der nicht als schreibgeschützt bekannt ist.",
  );
  expect(api.save).not.toHaveBeenCalled();
});

it("prefills reconnect metadata and scope while leaving both passwords empty", async () => {
  const api = actions();
  render(
    <LocaleProvider locale="de">
      <MailboxConnectionsPanel
        mailboxes={[
          {
            ...mailbox,
            historyDays: 365,
            folderPaths: ["INBOX"],
            sentCopyMode: "append",
            sentFolderPath: "Sent",
            configuration: {
              imap: {
                host: "incoming.example.com",
                port: 993,
                security: "tls",
                username: " exact-imap ",
              },
              smtp: {
                host: "outgoing.example.com",
                port: 587,
                security: "starttls",
                username: " exact-smtp ",
              },
            },
          },
        ]}
        actions={api}
      />
    </LocaleProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Postfach verwalten" }));
  fireEvent.click(screen.getByRole("button", { name: "Zugangsdaten aktualisieren" }));
  expect(screen.getByLabelText("Server für eingehende E-Mails")).toHaveValue(
    "incoming.example.com",
  );
  expect(screen.getByLabelText("Benutzername für Versand")).toHaveValue(" exact-smtp ");
  expect(screen.getByLabelText("Passwort für Empfang")).toHaveValue("");
  expect(screen.getByLabelText("Passwort für Versand")).toHaveValue("");
  fireEvent.change(screen.getByLabelText("Passwort für Empfang"), {
    target: { value: "new-imap" },
  });
  fireEvent.change(screen.getByLabelText("Passwort für Versand"), {
    target: { value: "new-smtp" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Verbindung prüfen" }));
  expect(await screen.findByLabelText("Zeitraum in Tagen")).toHaveValue("365");
  expect(screen.getByRole("checkbox", { name: "Gesendet" })).not.toBeChecked();
  expect(screen.getByRole("radio", { name: "Zusätzliche Kopie im Gesendet-Ordner" })).toBeChecked();
});
