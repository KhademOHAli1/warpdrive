// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { DeliveryObservationMessageRef } from "./deliveryObservationMessageRefs";
import { emailMessagesForLocale } from "./emailMessages";
import type { ThreadMessage } from "./emailReads";
import type { EmailTimelineMessage } from "./entityMessageReads";

const { reportProps, useQuery } = vi.hoisted(() => ({
  reportProps: vi.fn(),
  useQuery: vi.fn(),
}));
vi.mock("./ReaderDeliveryReports", () => ({
  ReaderDeliveryReports: (props: {
    accountId: string;
    messageId: string;
    threadId?: string;
    reference: DeliveryObservationMessageRef;
  }) => {
    reportProps(props);
    return <div data-testid="delivery-reports" data-message-id={props.messageId} />;
  },
}));
vi.mock("./MessageBodyFrame", () => ({
  MessageBodyFrame: ({ html }: { html: string }) => <div data-testid="message-body">{html}</div>,
}));
vi.mock("./ReaderActions", () => ({
  ReaderActions: () => <div data-testid="reader-actions" />,
}));
vi.mock("./EmailCardMenu", () => ({ EmailCardMenu: () => null }));
vi.mock("./linkActions", () => ({ linkThread: vi.fn() }));
vi.mock("@/components/shell/ActionErrorProvider", () => ({ useActionError: () => vi.fn() }));
vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    email: { message: { get: { useQuery: (...args: unknown[]) => useQuery(...args) } } },
    useUtils: () => ({}),
  },
}));

import { EmailTimelineCard } from "./EmailTimelineCard";
import { ReaderConversation } from "./ReaderConversation";
import { ReaderMessageCard } from "./ReaderMessageCard";

const locales = ["en", "fa", "de"] as const;
const sourceRef = { kind: "source", sourceMessageId: "source-message" } as const;
const attemptRef = { kind: "attempt", attemptId: "reviewed-attempt" } as const;
const baseMessage: ThreadMessage = {
  messageId: "source-message",
  gmailMessageId: null,
  direction: "inbound",
  fromEmail: "sender@mail.test",
  fromName: "Sender / فرستنده / Absender",
  toEmails: ["owner@mail.test"],
  ccEmails: ["copy@mail.test"],
  subject: "سلام / Grüße",
  bodyHtml: "<p>Readable original message</p>",
  sentAt: "2026-11-01T10:00:00Z",
  attachments: [
    { id: "attachment", filename: "details.pdf", mimeType: "application/pdf", sizeBytes: 8 },
  ],
  tracking: [],
  deliveryReportRef: sourceRef,
};
const timelineMessage: EmailTimelineMessage = {
  messageId: baseMessage.messageId,
  threadId: "timeline-thread",
  subject: baseMessage.subject,
  sentAt: baseMessage.sentAt,
  createdAt: "2026-11-01T10:00:01Z",
  direction: "inbound",
  fromEmail: baseMessage.fromEmail,
  fromName: baseMessage.fromName,
  toEmails: baseMessage.toEmails,
  snippet: "Original readable snippet",
  hasAttachment: true,
  canCompose: false,
};

afterEach(cleanup);
beforeEach(() => {
  reportProps.mockReset();
  useQuery.mockReset();
  useQuery.mockReturnValue({ data: undefined, isLoading: false, isError: false });
});

it.each(locales)("keeps the existing message card and scopes its report (%s)", (locale) => {
  const props = {
    message: baseMessage,
    accountId: "card-account",
    threadId: "card-thread",
    allowRemote: false,
    onShowRemote: () => {},
  };
  render(
    <LocaleProvider locale={locale}>
      <ReaderMessageCard {...props} />
    </LocaleProvider>,
  );

  const card = screen.getByTestId("reader-message-card");
  expect(card.tagName).toBe("ARTICLE");
  expect(card).toHaveClass("rounded-md", "border", "border-border", "bg-card", "p-4");
  expect(within(card).getByText(baseMessage.fromName ?? "")).toBeInTheDocument();
  expect(within(card).getByText(baseMessage.fromEmail)).toHaveAttribute("dir", "ltr");
  expect(within(card).getByText("owner@mail.test")).toBeInTheDocument();
  expect(within(card).getByText("copy@mail.test")).toBeInTheDocument();
  expect(within(card).getByTestId("message-body")).toHaveTextContent(baseMessage.bodyHtml);
  expect(within(card).getByRole("link", { name: /details.pdf/ })).toBeInTheDocument();
  expect(reportProps).toHaveBeenCalledWith({
    accountId: "card-account",
    messageId: baseMessage.messageId,
    threadId: "card-thread",
    reference: sourceRef,
  });
});

it.each([
  { name: "absent reference", reference: undefined, accountId: "account" },
  { name: "null reference", reference: null, accountId: "account" },
  { name: "absent mailbox scope", reference: sourceRef, accountId: undefined },
])("keeps ordinary cards quiet with $name", ({ reference, accountId }) => {
  const props = {
    message: { ...baseMessage, deliveryReportRef: reference },
    accountId,
    threadId: "thread",
    allowRemote: false,
    onShowRemote: () => {},
  };
  render(<ReaderMessageCard {...props} />);
  expect(screen.getByTestId("message-body")).toHaveTextContent(baseMessage.bodyHtml);
  expect(screen.queryByTestId("delivery-reports")).not.toBeInTheDocument();
  expect(reportProps).not.toHaveBeenCalled();
});

it.each(locales)(
  "scopes latest and mounted collapsed history without send authority (%s)",
  (locale) => {
    const messages = [
      { ...baseMessage, messageId: "latest-copy", deliveryReportRef: attemptRef },
      baseMessage,
      { ...baseMessage, messageId: "ordinary", deliveryReportRef: null },
    ];
    render(
      <LocaleProvider locale={locale}>
        <ReaderConversation
          messages={messages}
          accountId="conversation-account"
          threadId="conversation-thread"
          canCompose={false}
          ownerEmail="owner@mail.test"
          allowRemote={false}
          onShowRemote={() => {}}
          onSent={() => {}}
        />
      </LocaleProvider>,
    );

    const earlier = screen.getByRole("region", {
      name: emailMessagesForLocale(locale).workspace.earlierMessages(2),
    });
    expect(within(earlier).getByRole("button")).toHaveAttribute("aria-expanded", "false");
    const hidden = earlier.querySelector('[aria-hidden="true"][inert]');
    expect(hidden).not.toBeNull();
    expect(hidden?.querySelectorAll('[data-testid="reader-message-card"]')).toHaveLength(2);
    expect(hidden?.querySelector('[data-message-id="source-message"]')).not.toBeNull();
    expect(screen.getAllByTestId("delivery-reports")).toHaveLength(2);
    expect(reportProps).toHaveBeenCalledWith({
      accountId: "conversation-account",
      messageId: "source-message",
      threadId: "conversation-thread",
      reference: sourceRef,
    });
    expect(reportProps).toHaveBeenCalledWith({
      accountId: "conversation-account",
      messageId: "latest-copy",
      threadId: "conversation-thread",
      reference: attemptRef,
    });
    expect(screen.queryByTestId("reader-actions")).not.toBeInTheDocument();
  },
);

it.each(locales)(
  "loads timeline reports only on expansion using the body mailbox (%s)",
  (locale) => {
    useQuery.mockReturnValue({
      data: { ...baseMessage, accountId: "actual-body-account", ownerEmail: "owner@mail.test" },
      isLoading: false,
      isError: false,
    });
    render(
      <LocaleProvider locale={locale}>
        <EmailTimelineCard
          message={timelineMessage}
          scope={{ kind: "deal", dealId: "deal" }}
          onUnlinked={() => {}}
        />
      </LocaleProvider>,
    );
    const E = emailMessagesForLocale(locale);
    expect(useQuery).toHaveBeenLastCalledWith(
      { messageId: baseMessage.messageId, allowRemote: false },
      { enabled: false },
    );
    expect(screen.getByText("Original readable snippet")).toBeInTheDocument();
    expect(screen.queryByTestId("message-body")).not.toBeInTheDocument();
    expect(reportProps).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: E.expandEmail }));
    expect(useQuery).toHaveBeenLastCalledWith(
      { messageId: baseMessage.messageId, allowRemote: false },
      { enabled: true },
    );
    expect(screen.getByTestId("message-body")).toHaveTextContent(baseMessage.bodyHtml);
    expect(reportProps).toHaveBeenCalledWith({
      accountId: "actual-body-account",
      messageId: baseMessage.messageId,
      threadId: "timeline-thread",
      reference: sourceRef,
    });
    expect(screen.queryByTestId("reader-actions")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: E.collapseEmail }));
    expect(screen.queryByTestId("delivery-reports")).not.toBeInTheDocument();
    expect(useQuery).toHaveBeenLastCalledWith(
      { messageId: baseMessage.messageId, allowRemote: false },
      { enabled: false },
    );
  },
);
