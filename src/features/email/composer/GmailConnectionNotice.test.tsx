// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { GmailConnectionNotice } from "./GmailConnectionNotice";
import { composerMailboxMessages } from "./mailboxMessages";

afterEach(cleanup);
for (const locale of ["fa", "de", "en"] as const)
  it(`offers a safe route back to mailbox verification in ${locale}`, () => {
    const L = composerMailboxMessages(locale);
    render(
      <LocaleProvider locale={locale}>
        <GmailConnectionNotice reason="fresh_auth_required" />
      </LocaleProvider>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(L.connectFreshAuth);
    expect(screen.getByRole("link", { name: L.openConnections })).toHaveAttribute(
      "href",
      "/settings/email-sync",
    );
  });
for (const reason of ["synthetic-private-provider-response", "__proto__", "constructor"])
  it(`never renders arbitrary callback reason ${reason}`, () => {
    render(<GmailConnectionNotice reason={reason} />);
    expect(screen.queryByText("synthetic-private-provider-response")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      composerMailboxMessages("en").connectFailed,
    );
  });
