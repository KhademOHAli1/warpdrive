// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyReadIntent,
  applyUnreadIntent,
  prepareCreatedReadIntent,
  type ReadInput,
  reconcileAppliedReadIntent,
} from "./ThreadPane.readIntent.test.fixtures";

// B2: the reader header shows an owner-only privacy dropdown (ThreadPrivacyToggle), gated by
// canCompose, wired to setThreadVisibilityAction and surfacing a failed flip via useActionError.
type Res = { ok: true; value: { threadId: string } } | { ok: false; error: { id: string } };

vi.mock("./readActions", () => ({
  markThreadReadAction: vi.fn((_csrf: string, input: ReadInput) => applyReadIntent(input)),
  markThreadUnreadAction: vi.fn((_csrf: string, input: ReadInput) => applyUnreadIntent(input)),
}));
vi.mock("./readIntentActions", () => ({
  prepareThreadReadIntentAction: (_csrf: string, input: { threadId: string; read: boolean }) =>
    prepareCreatedReadIntent(input),
  reconcileThreadReadIntentAction: (_csrf: string, input: ReadInput) =>
    reconcileAppliedReadIntent(input),
}));
vi.mock("./threadAttributesActions", () => ({
  setFollowUpStatusAction: vi.fn(),
  setThreadLabelsAction: vi.fn(),
}));
const setThreadVisibilityMock = vi.fn<() => Promise<Res>>(() =>
  Promise.resolve({ ok: true, value: { threadId: "t1" } }),
);
vi.mock("./threadVisibilityActions", () => ({
  setThreadVisibilityAction: (...a: unknown[]) => setThreadVisibilityMock(...(a as [])),
}));
const reportErrorMock = vi.fn();
const refetchThread = vi.fn();
vi.mock("@/components/shell/ActionErrorProvider", () => ({
  useActionError: () => reportErrorMock,
}));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("./ReaderTopBar", () => ({ ReaderTopBar: () => null }));
vi.mock("./mailLabelsActions", () => ({ createMailLabelAction: vi.fn() }));

const threadData = {
  thread: {
    id: "t1",
    subject: "Renewal",
    lastMessageAt: null,
    personId: null,
    dealId: null,
    visibility: "private",
    unread: false,
    followUpStatus: null,
    labels: [] as string[],
  },
  messages: [] as never[],
  accountId: "acct1",
  canCompose: true,
  mailCapabilities: { read: true, send: false, markRead: false, move: false, trash: false },
  ownerEmail: "me@gunsnation.com",
  personName: null as string | null,
  dealTitle: null as string | null,
};
vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    mailLabels: { list: { useQuery: () => ({ data: [] }) } },
    email: { thread: { get: { useQuery: () => ({ data: threadData, refetch: refetchThread }) } } },
    pipeline: { list: { useQuery: () => ({ data: [] }) } },
    search: { query: { useQuery: () => ({ data: undefined }) } },
    useUtils: () => ({
      mailLabels: { list: { invalidate: vi.fn() } },
      email: {
        inbox: { list: { invalidate: vi.fn() }, unreadCount: { invalidate: vi.fn() } },
        listMessagesForDeal: { invalidate: vi.fn() },
        listMessagesForContact: { invalidate: vi.fn() },
      },
    }),
  },
}));

import { ThreadPane } from "./ThreadPane";

afterEach(() => {
  cleanup();
  setThreadVisibilityMock.mockClear();
  reportErrorMock.mockClear();
  refetchThread.mockClear();
  threadData.canCompose = true;
  threadData.thread.visibility = "private";
});

describe("ThreadPane reader-header privacy", () => {
  it("shows the privacy toggle when the user owns the mailbox (canCompose)", () => {
    threadData.canCompose = true;
    render(<ThreadPane threadId="t1" />);
    expect(screen.getByRole("button", { name: /private conversation/i })).toBeInTheDocument();
  });

  it("hides the privacy toggle on a thread the user cannot compose to", () => {
    threadData.canCompose = false;
    render(<ThreadPane threadId="t1" />);
    expect(screen.queryByRole("button", { name: /conversation/i })).not.toBeInTheDocument();
  });

  it("refreshes the reader and requests a workspace refresh after a successful flip", async () => {
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(<ThreadPane threadId="t1" onChanged={onChanged} />);
    await user.click(screen.getByRole("button", { name: /private conversation/i }));
    await user.click(screen.getByRole("menuitem", { name: /shared/i }));
    expect(setThreadVisibilityMock).toHaveBeenCalledExactlyOnceWith("csrf", {
      threadId: "t1",
      visibility: "shared",
    });
    expect(refetchThread).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(reportErrorMock).not.toHaveBeenCalled();
  });

  it("surfaces an error via the app-wide reporter when the flip fails", async () => {
    setThreadVisibilityMock.mockResolvedValueOnce({ ok: false, error: { id: "E_PERM_001" } });
    const user = userEvent.setup();
    threadData.canCompose = true;
    render(<ThreadPane threadId="t1" />);
    await user.click(screen.getByRole("button", { name: /private conversation/i }));
    await user.click(screen.getByRole("menuitem", { name: /shared/i }));
    expect(setThreadVisibilityMock).toHaveBeenCalledWith("csrf", {
      threadId: "t1",
      visibility: "shared",
    });
    expect(reportErrorMock).toHaveBeenCalledWith("E_PERM_001");
  });
});
