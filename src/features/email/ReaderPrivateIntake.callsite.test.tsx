// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { emailMessagesForLocale } from "./emailMessages";
import type { ThreadMessage } from "./emailReads";
import type { EmailTimelineMessage } from "./entityMessageReads";
import type { PrivateIntakeSummary } from "./privateIntakeTypes";

const { propsSpy, useQuery } = vi.hoisted(() => ({ propsSpy: vi.fn(), useQuery: vi.fn() }));
vi.mock("./ReaderPrivateIntake", () => ({
  ReaderPrivateIntake: (props: unknown) => {
    propsSpy(props);
    return <div data-testid="private-review" />;
  },
}));
vi.mock("./ReaderDeliveryReports", () => ({ ReaderDeliveryReports: () => null }));
vi.mock("./MessageBodyFrame", () => ({
  MessageBodyFrame: ({ html }: { html: string }) => <div data-testid="readable-body">{html}</div>,
}));
vi.mock("./ReaderActions", () => ({ ReaderActions: () => <div data-testid="reply-actions" /> }));
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

const summary: PrivateIntakeSummary = {
  id: "protected-intake",
  revision: 4,
  state: "unverified",
  contentState: "retained",
  decision: "dismiss",
};
const message: ThreadMessage = {
  messageId: "protected-message",
  gmailMessageId: null,
  direction: "inbound",
  fromEmail: "sender@mail.test",
  fromName: "فرستنده / Absender",
  toEmails: ["owner@mail.test"],
  ccEmails: [],
  subject: "محتوای خصوصی / Privater Inhalt",
  bodyHtml: "<p>Original readable private copy</p>",
  sentAt: "2026-11-01T10:00:00Z",
  attachments: [],
  tracking: [],
  privateIntake: summary,
};
const timeline: EmailTimelineMessage = {
  messageId: message.messageId,
  threadId: "timeline-thread",
  subject: message.subject,
  sentAt: message.sentAt,
  createdAt: "2026-11-01T10:00:00Z",
  direction: message.direction,
  fromEmail: message.fromEmail,
  fromName: message.fromName,
  toEmails: message.toEmails,
  snippet: "Original private snippet",
  hasAttachment: false,
  canCompose: false,
};
afterEach(cleanup);
beforeEach(() => {
  propsSpy.mockClear();
  useQuery.mockReset().mockReturnValue({ data: undefined, isLoading: false, isError: false });
});

it.each(["fa", "de", "en"] as const)(
  "preserves the %s reader card and passes its exact protected owner summary",
  (locale) => {
    render(
      <LocaleProvider locale={locale}>
        <ReaderMessageCard
          message={message}
          accountId="native-account"
          threadId="native-thread"
          allowRemote={false}
          onShowRemote={() => {}}
        />
      </LocaleProvider>,
    );
    const card = screen.getByTestId("reader-message-card");
    expect(card.tagName).toBe("ARTICLE");
    expect(card).toHaveClass("rounded-md", "border", "bg-card", "p-4");
    expect(within(card).getByTestId("readable-body")).toHaveTextContent(message.bodyHtml);
    expect(within(card).getByText(message.fromEmail)).toHaveAttribute("dir", "ltr");
    expect(propsSpy).toHaveBeenCalledWith({
      accountId: "native-account",
      messageId: message.messageId,
      threadId: "native-thread",
      summary,
    });
  },
);

it.each([
  { name: "ordinary message", summary: undefined, accountId: "account" },
  { name: "nonowner projection", summary: null, accountId: "account" },
  { name: "missing mailbox scope", summary, accountId: undefined },
])("does not mount the private client for $name", ({ summary: current, accountId }) => {
  render(
    <ReaderMessageCard
      message={{ ...message, privateIntake: current }}
      accountId={accountId}
      threadId="thread"
      allowRemote={false}
      onShowRemote={() => {}}
    />,
  );
  expect(screen.getByTestId("readable-body")).toHaveTextContent(message.bodyHtml);
  expect(propsSpy).not.toHaveBeenCalled();
});

it.each(["fa", "de", "en"] as const)(
  "keeps protected review available in %s conversation history when composing is forbidden",
  (locale) => {
    const latest = {
      ...message,
      messageId: "latest-protected",
      privateIntake: { ...summary, id: "latest-intake" },
    };
    render(
      <LocaleProvider locale={locale}>
        <ReaderConversation
          messages={[latest, message]}
          accountId="actual-account"
          threadId="actual-thread"
          ownerEmail="owner@mail.test"
          canCompose={false}
          allowRemote={false}
          onShowRemote={() => {}}
          onSent={() => {}}
        />
      </LocaleProvider>,
    );
    expect(screen.queryByTestId("reply-actions")).toBeNull();
    expect(propsSpy).toHaveBeenCalledWith({
      accountId: "actual-account",
      messageId: message.messageId,
      threadId: "actual-thread",
      summary,
    });
    expect(propsSpy).toHaveBeenCalledWith({
      accountId: "actual-account",
      messageId: latest.messageId,
      threadId: "actual-thread",
      summary: latest.privateIntake,
    });
    const earlier = screen.getByRole("region", {
      name: emailMessagesForLocale(locale).workspace.earlierMessages(1),
    });
    expect(earlier.querySelector('[inert] [data-testid="private-review"]')).not.toBeNull();
  },
);

it.each(["fa", "de", "en"] as const)(
  "mounts %s timeline private review only after expansion using the actual body mailbox",
  (locale) => {
    useQuery.mockReturnValue({
      data: { ...message, accountId: "body-owned-account", ownerEmail: "owner@mail.test" },
      isLoading: false,
      isError: false,
    });
    render(
      <LocaleProvider locale={locale}>
        <EmailTimelineCard
          message={timeline}
          scope={{ kind: "deal", dealId: "deal" }}
          onUnlinked={() => {}}
        />
      </LocaleProvider>,
    );
    expect(propsSpy).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: emailMessagesForLocale(locale).expandEmail }),
    );
    expect(propsSpy).toHaveBeenCalledWith({
      accountId: "body-owned-account",
      messageId: message.messageId,
      threadId: timeline.threadId,
      summary,
    });
    expect(screen.queryByTestId("reply-actions")).toBeNull();
  },
);
