// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { ThreadMessage } from "./emailReads";

vi.mock("@/features/deal-workspace/CollapsibleSection", () => ({
  CollapsibleSection: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("./ReaderMessageCard", () => ({
  ReaderMessageCard: ({ message }: { message: { messageId: string } }) => (
    <div>{message.messageId}</div>
  ),
}));
vi.mock("./ReaderActions", () => ({ ReaderActions: () => null }));

import { ReaderConversation } from "./ReaderConversation";

afterEach(cleanup);

it("renders non-Gmail history with unique stable internal message identities", () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const messages = [1, 2, 3, 4].map((n) => ({
      messageId: `message-${n}`,
      gmailMessageId: null,
      direction: "inbound",
      fromEmail: "sender@mail.test",
      fromName: null,
      toEmails: [],
      ccEmails: [],
      subject: "سلام / Grüße",
      bodyHtml: "<p>body</p>",
      sentAt: `2026-10-${20 + n}T12:00:00Z`,
      attachments: [],
      tracking: [],
    })) as ThreadMessage[];
    render(
      <ReaderConversation
        messages={messages}
        allowRemote={false}
        onShowRemote={() => {}}
        canCompose={false}
        ownerEmail="owner@mail.test"
        accountId="account"
        threadId="thread"
        onSent={() => {}}
      />,
    );
    expect(errors.mock.calls.some((args) => String(args[0]).includes("same key"))).toBe(false);
  } finally {
    errors.mockRestore();
  }
});
