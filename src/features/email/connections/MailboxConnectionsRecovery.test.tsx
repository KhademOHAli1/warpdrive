// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { MailboxConnectionsPanel } from "./MailboxConnectionsPanel";
import type { MailboxConnectionActions, MailboxConnectionView } from "./types";

const capabilities = { read: true, send: true, markRead: true, move: false, trash: false };
const existing: MailboxConnectionView = {
  id: "owned-account",
  provider: "imap_smtp",
  emailAddress: "vertrieb@example.com",
  status: "paused",
  isDefault: false,
  capabilities,
  lastSyncAtIso: null,
};
function facade() {
  const actions: MailboxConnectionActions = {
    check: vi.fn().mockResolvedValue({
      ok: true,
      value: {
        checkId: "proof",
        mailboxAddress: "vertrieb@example.com",
        capabilities,
        folders: [{ path: "INBOX", name: "Inbox", role: "inbox", readOnly: true }],
      },
    }),
    save: vi.fn().mockResolvedValue({ ok: true, value: existing }),
    mutate: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
  };
  return actions;
}
function fillGermanCredentials() {
  for (const [label, value] of [
    ["E-Mail-Adresse", "vertrieb@example.com"],
    ["Server für eingehende E-Mails", "imap.example.com"],
    ["Server für ausgehende E-Mails", "smtp.example.com"],
    ["Benutzername für Empfang", "  exact-user  "],
    ["Benutzername für Versand", "  exact-user  "],
    ["Passwort für Empfang", "  exact-password  "],
    ["Passwort für Versand", "  exact-password  "],
  ])
    fireEvent.change(screen.getByLabelText(label!), { target: { value } });
}
async function checkedGerman(actions: MailboxConnectionActions) {
  render(
    <LocaleProvider locale="de">
      <MailboxConnectionsPanel mailboxes={[]} actions={actions} />
    </LocaleProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Postfach hinzufügen" }));
  fireEvent.click(screen.getByRole("button", { name: "Eigenes E-Mail-Postfach" }));
  fillGermanCredentials();
  fireEvent.click(screen.getByRole("button", { name: "Verbindung prüfen" }));
  await screen.findByRole("heading", { name: "Synchronisierung auswählen" });
}
afterEach(cleanup);

it("updates the dialog heading for server configuration and sync selection", async () => {
  const actions = facade();
  await checkedGerman(actions);
  expect(screen.getByRole("dialog", { name: "Synchronisierung auswählen" })).toBeVisible();
});

it("accepts Persian history digits, keeps read-only folders selectable and preserves credential bytes", async () => {
  const actions = facade();
  await checkedGerman(actions);
  expect(screen.getByText("Schreibgeschützter Ordner")).toBeVisible();
  expect(screen.getByRole("checkbox", { name: "Posteingang" })).not.toBeDisabled();
  fireEvent.change(screen.getByLabelText("Zeitraum in Tagen"), { target: { value: "۳۶۵" } });
  fireEvent.click(screen.getByRole("button", { name: "Postfach verbinden" }));
  await waitFor(() => expect(actions.save).toHaveBeenCalled());
  expect(actions.save).toHaveBeenCalledWith(
    expect.objectContaining({ historyDays: 365 }),
    expect.any(AbortSignal),
  );
  expect(actions.check).toHaveBeenCalledWith(
    expect.objectContaining({
      imap: expect.objectContaining({
        username: "  exact-user  ",
        password: "  exact-password  ",
        port: 993,
      }),
    }),
    expect.any(AbortSignal),
  );
});

it("rejects an excessive history range and an empty folder selection locally", async () => {
  const actions = facade();
  await checkedGerman(actions);
  fireEvent.change(screen.getByLabelText("Zeitraum in Tagen"), { target: { value: "3651" } });
  fireEvent.click(screen.getByRole("button", { name: "Postfach verbinden" }));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Geben Sie eine ganze Zahl zwischen 1 und 3.650 Tagen ein.",
  );
  expect(actions.save).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Zeitraum in Tagen"), { target: { value: "90" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "Posteingang" }));
  fireEvent.click(screen.getByRole("button", { name: "Postfach verbinden" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Wählen Sie mindestens einen Ordner aus.");
});

it("recovers an expired proof through a new check instead of retaining passwords", async () => {
  const actions = facade();
  vi.mocked(actions.save).mockResolvedValueOnce({ ok: false, error: "stale_check" });
  await checkedGerman(actions);
  fireEvent.click(screen.getByRole("button", { name: "Postfach verbinden" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Erneut prüfen" }));
  expect(screen.getByLabelText("Passwort für Empfang")).toHaveValue("");
  expect(screen.getByLabelText("Passwort für Versand")).toHaveValue("");
  expect(screen.getByLabelText("E-Mail-Adresse")).toHaveValue("vertrieb@example.com");
  expect(actions.check).toHaveBeenCalledTimes(1);
});

it("provides identity confirmation and keeps provider exception messages out of the UI", async () => {
  const actions = facade();
  vi.mocked(actions.check).mockRejectedValueOnce(new Error("secret server diagnostic"));
  render(
    <LocaleProvider locale="de">
      <MailboxConnectionsPanel mailboxes={[]} actions={actions} />
    </LocaleProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Postfach hinzufügen" }));
  fireEvent.click(screen.getByRole("button", { name: "Eigenes E-Mail-Postfach" }));
  fillGermanCredentials();
  fireEvent.click(screen.getByRole("button", { name: "Verbindung prüfen" }));
  await screen.findByRole("alert");
  expect(screen.queryByText("secret server diagnostic")).not.toBeInTheDocument();
  vi.mocked(actions.check).mockResolvedValueOnce({ ok: false, error: "fresh_auth_required" });
  fireEvent.click(screen.getByRole("button", { name: "Verbindung prüfen" }));
  expect(
    await screen.findByRole("link", { name: "Identität in der Kontosicherheit bestätigen" }),
  ).toHaveAttribute("href", "/settings/security?returnTo=%2Fsettings%2Femail-sync");
});

it("reconnects only the existing account and displays a readonly mailbox address", async () => {
  const actions = facade();
  render(
    <LocaleProvider locale="de">
      <MailboxConnectionsPanel mailboxes={[existing]} actions={actions} />
    </LocaleProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Postfach verwalten" }));
  fireEvent.click(screen.getByRole("button", { name: "Zugangsdaten aktualisieren" }));
  expect(screen.getByLabelText("E-Mail-Adresse")).toHaveAttribute("readonly");
  fillGermanCredentials();
  fireEvent.click(screen.getByRole("button", { name: "Verbindung prüfen" }));
  await waitFor(() =>
    expect(actions.check).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: "owned-account" }),
      expect.any(AbortSignal),
    ),
  );
});

it("resumes a paused connection and offers a default sender only for send-capable accounts", async () => {
  const actions = facade();
  render(
    <LocaleProvider locale="de">
      <MailboxConnectionsPanel
        mailboxes={[{ ...existing, capabilities: { ...capabilities, send: false } }]}
        actions={actions}
      />
    </LocaleProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Postfach verwalten" }));
  expect(
    screen.queryByRole("button", { name: "Als Standardabsender festlegen" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Synchronisierung fortsetzen" }));
  await waitFor(() =>
    expect(actions.mutate).toHaveBeenCalledWith("owned-account", "resume", expect.any(AbortSignal)),
  );
});

it("makes unavailable Gmail reauthorization explicit instead of showing an inert action", () => {
  render(
    <LocaleProvider locale="de">
      <MailboxConnectionsPanel
        mailboxes={[{ ...existing, provider: "gmail" }]}
        actions={facade()}
      />
    </LocaleProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Postfach verwalten" }));
  expect(screen.getByRole("button", { name: "Zugangsdaten aktualisieren" })).toBeDisabled();
  expect(
    screen.getByText(
      "Die Google-Postfachverbindung ist für diese Installation nicht eingerichtet.",
    ),
  ).toBeVisible();
});

it("clears both secrets before opening native identity confirmation, then permits a fresh retry", async () => {
  const actions = facade();
  vi.mocked(actions.check).mockResolvedValueOnce({ ok: false, error: "fresh_auth_required" });
  const confirm = vi.fn(() => {
    expect(screen.getByLabelText("Passwort für Empfang")).toHaveValue("");
    expect(screen.getByLabelText("Passwort für Versand")).toHaveValue("");
  });
  render(
    <LocaleProvider locale="de">
      <MailboxConnectionsPanel mailboxes={[]} actions={actions} onRequireFreshAuth={confirm} />
    </LocaleProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Postfach hinzufügen" }));
  fireEvent.click(screen.getByRole("button", { name: "Eigenes E-Mail-Postfach" }));
  fillGermanCredentials();
  fireEvent.click(screen.getByRole("button", { name: "Verbindung prüfen" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Identität in der Kontosicherheit bestätigen" }),
  );
  expect(confirm).toHaveBeenCalledOnce();
  expect(screen.getByLabelText("E-Mail-Adresse")).toHaveValue("vertrieb@example.com");
  fireEvent.change(screen.getByLabelText("Passwort für Empfang"), {
    target: { value: "fresh-imap" },
  });
  fireEvent.change(screen.getByLabelText("Passwort für Versand"), {
    target: { value: "fresh-smtp" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Verbindung prüfen" }));
  await screen.findByRole("dialog", { name: "Synchronisierung auswählen" });
  expect(actions.check).toHaveBeenLastCalledWith(
    expect.objectContaining({
      imap: expect.objectContaining({ password: "fresh-imap" }),
      smtp: expect.objectContaining({ password: "fresh-smtp" }),
    }),
    expect.any(AbortSignal),
  );
});

it("shows an unprobed folder as unknown access without claiming it is writable", async () => {
  const actions = facade();
  vi.mocked(actions.check).mockResolvedValueOnce({
    ok: true,
    value: {
      checkId: "proof",
      mailboxAddress: "vertrieb@example.com",
      capabilities,
      folders: [{ path: "INBOX", name: "Inbox", role: "inbox", readOnly: null }],
    },
  });
  await checkedGerman(actions);
  expect(screen.getByText("Zugriff ungeprüft")).toBeVisible();
  expect(screen.queryByText("Schreibgeschützter Ordner")).not.toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: "Posteingang" })).toBeChecked();
});
