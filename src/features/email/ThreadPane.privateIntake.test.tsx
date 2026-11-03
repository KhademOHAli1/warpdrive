// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, configure, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { deferred } from "./deliveryObservationReader.fixtures";
import { emailMessagesForLocale } from "./emailMessages";
import type { ThreadMessage } from "./emailReads";
import {
  privateReaderIds,
  privateReaderInvalidate,
  privateReaderReview,
  privateReaderSummary,
  privateReaderUtils,
  resetPrivateReader,
} from "./privateIntakeReader.fixtures";
import type {
  PrivateIntakeReviewInput,
  PrivateIntakeReviewResult,
  PrivateIntakeSummary,
} from "./privateIntakeTypes";
import {
  applyReadIntent,
  applyUnreadIntent,
  prepareCreatedReadIntent,
  READ_OPERATION_ID,
  type ReadInput,
  reconcileAppliedReadIntent,
  UNREAD_OPERATION_ID,
} from "./ThreadPane.readIntent.test.fixtures";

type PrepareRead = (
  csrf: string | null,
  input: Parameters<typeof prepareCreatedReadIntent>[0],
) => ReturnType<typeof prepareCreatedReadIntent>;
type ExecuteRead = (csrf: string | null, input: ReadInput) => ReturnType<typeof applyReadIntent>;
type ReconcileRead = (
  csrf: string | null,
  input: ReadInput,
) => ReturnType<typeof reconcileAppliedReadIntent>;
const { query, markRead, markUnread, prepareRead, reconcileRead } = vi.hoisted(() => ({
  query: vi.fn(),
  markRead: vi.fn<ExecuteRead>(),
  markUnread: vi.fn<ExecuteRead>(),
  prepareRead: vi.fn<PrepareRead>(),
  reconcileRead: vi.fn<ReconcileRead>(),
}));
vi.mock("./privateIntakeTransport.client", () => ({
  readPrivateIntakeSummary: vi.fn(),
  reviewPrivateIntakeSummary: vi.fn(),
}));
vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    useUtils: () => privateReaderUtils,
    email: { thread: { get: { useQuery: () => query() } } },
  },
}));
vi.mock("./readActions", () => ({
  markThreadReadAction: markRead,
  markThreadUnreadAction: markUnread,
}));
vi.mock("./readIntentActions", () => ({
  prepareThreadReadIntentAction: prepareRead,
  reconcileThreadReadIntentAction: reconcileRead,
}));
vi.mock("./ReaderTopBar", () => ({ ReaderTopBar: () => null }));
vi.mock("./InboxReaderSidebar", () => ({ InboxReaderSidebar: () => null }));
vi.mock("./ThreadFollowUpControls", () => ({ ThreadFollowUpControls: () => null }));
vi.mock("./ThreadPrivacyToggle", () => ({ ThreadPrivacyToggle: () => null }));
vi.mock("./ReaderActions", () => ({ ReaderActions: () => null }));
vi.mock("./MessageBodyFrame", () => ({
  MessageBodyFrame: () => <div data-testid="message-body" />,
}));

import { ThreadPane } from "./ThreadPane";

const purged: PrivateIntakeSummary = {
  ...privateReaderSummary,
  state: "confirmed_notification",
  contentState: "purged",
  decision: "restore_private",
};
const data = {
  thread: {
    id: privateReaderIds.thread,
    subject: "خصوصی / Privat",
    lastMessageAt: null,
    personId: null,
    dealId: null,
    visibility: "private",
    unread: false,
    followUpStatus: null,
    labels: [] as string[],
    isOwner: true,
    privateIntake: purged as PrivateIntakeSummary | null,
  },
  messages: [] as ThreadMessage[],
  accountId: privateReaderIds.account,
  canCompose: true,
  ownerEmail: "owner@mail.test",
  personName: null,
  dealTitle: null,
  privateIntake: purged as PrivateIntakeSummary | null,
  mailCapabilities: {
    read: true,
    send: false,
    markRead: false,
    move: false,
    trash: false,
    localRead: undefined as boolean | undefined,
  },
};
beforeEach(() => {
  configure({ asyncUtilTimeout: 500 });
  resetPrivateReader();
  prepareRead.mockReset().mockImplementation((_csrf, input) => prepareCreatedReadIntent(input));
  reconcileRead.mockReset().mockImplementation((_csrf, input) => reconcileAppliedReadIntent(input));
  markRead.mockReset().mockImplementation((_csrf, input) => applyReadIntent(input));
  markUnread.mockReset().mockImplementation((_csrf, input) => applyUnreadIntent(input));
  data.thread.id = privateReaderIds.thread;
  data.thread.isOwner = true;
  data.thread.privateIntake = purged;
  data.privateIntake = purged;
  data.messages = [];
  data.canCompose = true;
  data.mailCapabilities.markRead = false;
  data.mailCapabilities.localRead = undefined;
  query.mockReturnValue({ data, refetch: vi.fn() });
});
afterEach(cleanup);

it.each(["fa", "de", "en"] as const)(
  "keeps purged owner metadata review reachable in an actual empty %s ThreadPane",
  async (locale) => {
    const text = emailMessagesForLocale(locale).privateIntake;
    privateReaderReview.mockImplementation((raw) => {
      const input = raw as PrivateIntakeReviewInput;
      return Promise.resolve({
        ok: true,
        value: {
          ...purged,
          id: input.intakeId,
          revision: input.expectedRevision + 1,
          decision: input.decision,
        },
      });
    });
    render(
      <LocaleProvider locale={locale}>
        <ThreadPane threadId={data.thread.id} trackingBadge={null} embedded />
      </LocaleProvider>,
    );
    const region = screen.getByRole("region", { name: text.title });
    expect(region.closest("[data-reader-scroll]")).not.toBeNull();
    expect(screen.queryByTestId("reader-message-card")).toBeNull();
    expect(screen.getByText(text.contentRemoved)).toBeVisible();
    const user = userEvent.setup();
    const trigger = screen.getByRole("button", { name: text.review });
    trigger.focus();
    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("button", { name: text.keepPrivate }));
    expect(privateReaderReview).toHaveBeenCalledExactlyOnceWith(
      {
        accountId: privateReaderIds.account,
        intakeId: purged.id,
        expectedRevision: purged.revision,
        decision: "keep_private",
      },
      expect.any(AbortSignal),
    );
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(text.saved));
    expect(screen.getByText(text.contentRemoved)).toBeVisible();
    expect(screen.getByText(text.states.confirmed_notification)).toBeVisible();
    expect(markRead).not.toHaveBeenCalled();
  },
);

it.each(["ordinary", "foreign", "retained"] as const)(
  "keeps an empty %s reader quiet without inventing a message identity",
  (kind) => {
    if (kind === "ordinary") {
      data.privateIntake = null;
      data.thread.privateIntake = null;
    }
    if (kind === "foreign") data.thread.isOwner = false;
    if (kind === "retained") {
      data.privateIntake = { ...purged, contentState: "retained" };
      data.thread.privateIntake = data.privateIntake;
    }
    render(<ThreadPane threadId={data.thread.id} trackingBadge={null} embedded />);
    expect(screen.queryByRole("region", { name: "Private email review" })).toBeNull();
    expect(privateReaderReview).not.toHaveBeenCalled();
  },
);

it("keeps a protected purged-owner review available when composing is forbidden", () => {
  data.privateIntake = { ...purged, state: "unverified" };
  data.thread.privateIntake = data.privateIntake;
  data.canCompose = false;
  render(<ThreadPane threadId={data.thread.id} trackingBadge={null} embedded />);
  expect(screen.getByRole("region", { name: "Private email review" })).toBeVisible();
  expect(screen.getByText("Needs review")).toBeVisible();
  expect(markRead).not.toHaveBeenCalled();
});

it("keeps the normal message-card placement and never duplicates the private panel", () => {
  const summary = { ...privateReaderSummary };
  data.privateIntake = summary;
  data.thread.privateIntake = summary;
  data.messages = [
    {
      messageId: privateReaderIds.message,
      gmailMessageId: null,
      direction: "inbound",
      fromEmail: "sender@mail.test",
      fromName: null,
      toEmails: [],
      ccEmails: [],
      subject: "Private",
      bodyHtml: "<p>Retained</p>",
      sentAt: null,
      attachments: [],
      tracking: [],
      privateIntake: summary,
    },
  ];
  render(<ThreadPane threadId={data.thread.id} trackingBadge={null} embedded />);
  expect(screen.getAllByRole("region", { name: "Private email review" })).toHaveLength(1);
  expect(
    screen
      .getByRole("region", { name: "Private email review" })
      .closest("[data-testid='reader-message-card']"),
  ).not.toBeNull();
});

it("cancels a purged thread review when its actual thread identity changes", async () => {
  const pending = deferred<PrivateIntakeReviewResult>();
  privateReaderReview.mockReturnValueOnce(pending.promise);
  const view = render(<ThreadPane threadId={data.thread.id} trackingBadge={null} embedded />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Review copy" }));
  await user.click(screen.getByRole("button", { name: "Keep private" }));
  const signal = privateReaderReview.mock.calls[0]?.[1];
  data.thread.id = privateReaderIds.otherAccount;
  view.rerender(<ThreadPane threadId={data.thread.id} trackingBadge={null} embedded />);
  expect(signal?.aborted).toBe(true);
  await act(async () => {
    pending.resolve({ ok: true, value: { ...purged, revision: 5, decision: "keep_private" } });
    await pending.promise;
  });
  expect(privateReaderInvalidate).not.toHaveBeenCalled();
  expect(screen.queryByText("Review saved")).toBeNull();
});

const readWorkflows = (["fa", "de", "en"] as const).flatMap((locale) =>
  (["held_local", "held_denied", "ordinary"] as const).map((kind) => ({ locale, kind })),
);
it.each(readWorkflows)(
  "supports the $kind read workflow in the actual $locale ThreadPane",
  async ({ locale, kind }) => {
    const ordinary = kind === "ordinary";
    data.privateIntake = ordinary ? null : { ...purged, state: "unverified" };
    data.thread.privateIntake = data.privateIntake;
    data.canCompose = ordinary;
    data.mailCapabilities.markRead = ordinary;
    data.mailCapabilities.localRead = kind === "held_local" ? true : undefined;
    const text = emailMessagesForLocale(locale);
    render(
      <LocaleProvider locale={locale}>
        <ThreadPane threadId={data.thread.id} trackingBadge={null} embedded />
      </LocaleProvider>,
    );
    const unread = screen.getByRole("button", { name: text.markAsUnread });
    if (kind === "held_denied") {
      expect(unread).toBeDisabled();
      await userEvent.setup().click(unread);
      expect(prepareRead).not.toHaveBeenCalled();
      expect(markRead).not.toHaveBeenCalled();
      expect(markUnread).not.toHaveBeenCalled();
      return;
    }
    await waitFor(() => expect(markRead).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(privateReaderInvalidate).toHaveBeenCalledTimes(2));
    expect(unread).toBeEnabled();
    expect(prepareRead).toHaveBeenCalledTimes(1);
    expect(prepareRead.mock.calls[0]?.[1]).toEqual({
      threadId: data.thread.id,
      read: true,
    });
    expect(markRead.mock.calls[0]?.[1]).toEqual({
      threadId: data.thread.id,
      operationId: READ_OPERATION_ID,
    });
    await userEvent.setup().click(unread);
    expect(markUnread).toHaveBeenCalledTimes(1);
    expect(prepareRead).toHaveBeenCalledTimes(2);
    expect(prepareRead.mock.calls[1]?.[1]).toEqual({ threadId: data.thread.id, read: false });
    expect(markUnread.mock.calls[0]?.[1]).toEqual({
      threadId: data.thread.id,
      operationId: UNREAD_OPERATION_ID,
    });
    await waitFor(() => expect(privateReaderInvalidate).toHaveBeenCalledTimes(4));
    expect(screen.queryByText(text.remoteActions.readStatusFailed)).toBeNull();
  },
);
