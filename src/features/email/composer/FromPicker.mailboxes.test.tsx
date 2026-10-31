// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { MailboxConnectionView } from "../connections/types";
import { FromPicker } from "./FromPicker";
import { composerMailboxMessages } from "./mailboxMessages";

afterEach(cleanup);
const mailbox = (
  id: string,
  emailAddress: string,
  status: MailboxConnectionView["status"] = "connected",
): MailboxConnectionView => ({
  id,
  emailAddress,
  provider: "imap_smtp",
  status,
  isDefault: id === "first",
  lastSyncAtIso: null,
  capabilities: { read: true, send: true, markRead: true, move: true, trash: true },
});
const mailboxes = [
  mailbox("first", "first@example.com"),
  mailbox("second", "second@example.com"),
  mailbox("paused", "paused@example.com", "paused"),
];
for (const locale of ["fa", "de", "en"] as const)
  it(`offers only active sender mailboxes and locks replies in ${locale}`, () => {
    const L = composerMailboxMessages(locale);
    const onChange = vi.fn();
    const view = render(
      <LocaleProvider locale={locale}>
        <FromPicker
          address="first@example.com"
          accountId="first"
          mailboxes={mailboxes}
          onChange={onChange}
        />
      </LocaleProvider>,
    );
    const picker = screen.getByRole("combobox", { name: L.chooseSender });
    fireEvent.keyDown(picker, { key: "ArrowDown" });
    expect(screen.queryByRole("option", { name: /paused@example.com/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: /second@example.com/ }));
    expect(onChange).toHaveBeenCalledWith("second");
    view.rerender(
      <LocaleProvider locale={locale}>
        <FromPicker
          address="first@example.com"
          accountId="first"
          mailboxes={mailboxes}
          onChange={onChange}
          locked
        />
      </LocaleProvider>,
    );
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByText(L.replyLocked)).toBeInTheDocument();
  });
