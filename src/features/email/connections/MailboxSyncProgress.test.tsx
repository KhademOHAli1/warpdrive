// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { mailboxViewSchema } from "./apiSchemas";
import { MailboxConnectionRow } from "./MailboxConnectionRow";
import { mailboxConnectionMessages } from "./messages";
import type { MailboxConnectionActions, MailboxConnectionView } from "./types";

const actions: MailboxConnectionActions = {
  check: () => Promise.resolve({ ok: false, error: "unknown" }),
  save: () => Promise.resolve({ ok: false, error: "unknown" }),
  mutate: () => Promise.resolve({ ok: true, value: undefined }),
};
const mailbox: MailboxConnectionView = {
  id: "mailbox",
  provider: "imap_smtp",
  emailAddress: "preview@example.com",
  status: "connected",
  isDefault: true,
  lastSyncAtIso: null,
  capabilities: { read: true, send: true, markRead: true, move: true, trash: true },
  syncProgress: {
    processed: 21,
    total: null,
    skipped: 3,
    skipReasons: { messageTooLarge: 1, invalidMessage: 1, messageMissing: 1 },
  },
};
afterEach(cleanup);
for (const [locale, processed, skipped] of [
  ["fa", "۲۱ مورد پردازش شد", "۳ مورد کنار گذاشته شد"],
  ["de", "21 Einträge verarbeitet", "3 Einträge übersprungen"],
  ["en", "21 items processed", "3 items skipped"],
] as const)
  it(`shows actual processed items, finite skipped reasons and parsing limits in ${locale}`, () => {
    render(
      <LocaleProvider locale={locale}>
        <ul>
          <MailboxConnectionRow
            mailbox={mailbox}
            actions={actions}
            gmailAvailable={false}
            onChanged={vi.fn()}
            onNotice={vi.fn()}
          />
        </ul>
      </LocaleProvider>,
    );
    expect(screen.getByText(processed)).toBeInTheDocument();
    expect(screen.getByText(skipped)).toBeInTheDocument();
    expect(screen.getByText(/MiB/)).toHaveTextContent(locale === "fa" ? "۲۵" : "25");
    expect(screen.getByText(/MiB/)).toHaveTextContent(locale === "fa" ? "۱۰" : "10");
    expect(
      screen.getByRole("list", { name: mailboxConnectionMessages(locale).skippedReasonDetails })
        .children,
    ).toHaveLength(3);
  });
it("retains only finite validated progress metadata from the list API", () => {
  const value = mailboxViewSchema.parse({
    ...mailbox,
    syncProgress: {
      ...mailbox.syncProgress,
      rawUID: "private-marker",
      skipReasons: {
        messageTooLarge: 1,
        invalidMessage: 1,
        messageMissing: 1,
        rawDiagnostic: "private-marker",
      },
    },
  });
  expect(value.syncProgress).toEqual(mailbox.syncProgress);
  expect(
    mailboxViewSchema.safeParse({
      ...mailbox,
      syncProgress: { ...mailbox.syncProgress, skipped: -1 },
    }).success,
  ).toBe(false);
  expect(
    mailboxViewSchema.safeParse({
      ...mailbox,
      syncProgress: {
        ...mailbox.syncProgress,
        skipReasons: { messageTooLarge: 1, invalidMessage: -1, messageMissing: 0 },
      },
    }).success,
  ).toBe(false);
});
