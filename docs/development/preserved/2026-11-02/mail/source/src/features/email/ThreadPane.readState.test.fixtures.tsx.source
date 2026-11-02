import { configure } from "@testing-library/react";
import { vi } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { ActionResult } from "@/types/actionResult";
import type { ThreadMessage } from "./emailReads";
import {
  privateReaderSummary,
  privateReaderUtils,
  resetPrivateReader,
  privateReaderIds as sharedPrivateReaderIds,
  privateReaderInvalidate as sharedPrivateReaderInvalidate,
} from "./privateIntakeReader.fixtures";
import type {
  ReadActionValue,
  ReadIntentPreparation,
  ReadIntentReceipt,
  ReadIntentState,
} from "./readIntentTypes";

const {
  query,
  refetch,
  freshQuery,
  setThreadData,
  markRead,
  markUnread,
  prepareRead,
  reconcileRead,
  privateRead,
  privateReview,
} = vi.hoisted(() => ({
  query:
    vi.fn<
      () => {
        data: ReadStateData;
        error: null;
        refetch: () => Promise<unknown>;
      }
    >(),
  refetch: vi.fn(),
  freshQuery: vi.fn(),
  setThreadData: vi.fn(),
  markRead: vi.fn(),
  markUnread: vi.fn(),
  prepareRead: vi.fn(),
  reconcileRead: vi.fn(),
  privateRead: vi.fn(),
  privateReview: vi.fn(),
}));

export {
  freshQuery,
  markRead,
  markUnread,
  prepareRead,
  query,
  reconcileRead,
  refetch,
  setThreadData,
};
export const privateReaderIds = sharedPrivateReaderIds;
export const privateReaderInvalidate = sharedPrivateReaderInvalidate;

vi.mock("./privateIntakeTransport.client", () => ({
  readPrivateIntakeSummary: privateRead,
  reviewPrivateIntakeSummary: privateReview,
}));
vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    useUtils: () => ({
      ...privateReaderUtils,
      client: { email: { thread: { get: { query: freshQuery } } } },
      email: {
        ...privateReaderUtils.email,
        thread: { get: { ...privateReaderUtils.email.thread.get, setData: setThreadData } },
      },
    }),
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
// A stateful child probe detects remounts; composer behavior has its own tests.
vi.mock("./ReaderConversation", () => ({
  ReaderConversation: () => (
    <div data-testid="reader-body">
      Message body retained
      <input aria-label="Draft preservation probe" defaultValue="" />
    </div>
  ),
}));

import { ThreadPane } from "./ThreadPane";

export function readerData(id: string = privateReaderIds.thread) {
  const summary = { ...privateReaderSummary, state: "unverified" as const };
  return {
    thread: {
      id,
      subject: "خصوصی / Privat",
      lastMessageAt: null,
      personId: null,
      dealId: null,
      visibility: "private",
      unread: false,
      followUpStatus: null,
      labels: [] as string[],
      isOwner: true,
      privateIntake: summary,
    },
    messages: [] as ThreadMessage[],
    accountId: privateReaderIds.account,
    canCompose: false,
    ownerEmail: "owner@mail.test",
    personName: null,
    dealTitle: null,
    privateIntake: summary,
    mailCapabilities: {
      read: true,
      send: false,
      markRead: false,
      move: false,
      trash: false,
      localRead: true,
    },
  };
}
export type ReadStateData = ReturnType<typeof readerData>;
export const readerState = { data: readerData() };
export function cachedRead(value = readerState.data) {
  return { data: value, error: null, isError: false, isSuccess: true, status: "success" as const };
}
export const unknownRead = () => ({ ok: false as const, error: { id: ERROR_IDS.DB_WRITE_FAILED } });
let intentSequence = 0;
const intents = new Map<string, ReadIntentReceipt>();
let latestIntent: ReadIntentReceipt;
export function readIntentReceipt(
  state: ReadIntentState = "applied",
  overrides: Partial<ReadIntentReceipt> = {},
): ReadIntentReceipt {
  return { ...latestIntent, state, ...overrides };
}
export function preparedReadIntent(threadId = readerState.data.thread.id, desiredRead = true) {
  intentSequence += 1;
  const receipt: ReadIntentReceipt = {
    operationId: `11111111-1111-4111-8111-${String(intentSequence).padStart(12, "0")}`,
    threadId,
    desiredRead,
    state: "prepared",
    admitBefore: "2099-01-01T00:00:00.000Z",
  };
  intents.set(receipt.operationId, receipt);
  latestIntent = receipt;
  return receipt;
}
function appliedReadResult(
  input: { threadId: string; operationId: string },
  desiredRead: boolean,
): ActionResult<ReadActionValue> {
  const intent = intents.get(input.operationId);
  if (
    intent === undefined ||
    intent.threadId !== input.threadId ||
    intent.desiredRead !== desiredRead
  )
    return { ok: false, error: { id: ERROR_IDS.GMAIL_READ_INPUT_INVALID } };
  return {
    ok: true,
    value: { threadId: input.threadId, readIntent: { ...intent, state: "applied" } },
  };
}
export const changed = vi.fn();
export const close = vi.fn();
export function readerUi(locale: "fa" | "de" | "en") {
  return (
    <LocaleProvider locale={locale}>
      <ThreadPane
        threadId={readerState.data.thread.id}
        trackingBadge={null}
        embedded
        onChanged={changed}
        onClose={close}
      />
    </LocaleProvider>
  );
}
export function resetReadStateFixture() {
  configure({ asyncUtilTimeout: 500 });
  resetPrivateReader();
  readerState.data = readerData();
  intentSequence = 0;
  intents.clear();
  preparedReadIntent();
  prepareRead.mockReset().mockImplementation(
    (
      _csrf: unknown,
      input: { threadId: string; read: boolean },
    ): Promise<ActionResult<ReadIntentPreparation>> =>
      Promise.resolve({
        ok: true,
        value: { kind: "created", readIntent: preparedReadIntent(input.threadId, input.read) },
      }),
  );
  reconcileRead
    .mockReset()
    .mockImplementation(
      (
        _csrf: unknown,
        input: { threadId: string; operationId: string },
      ): Promise<ActionResult<ReadIntentReceipt>> => {
        const receipt = intents.get(input.operationId);
        return Promise.resolve(
          receipt === undefined || receipt.threadId !== input.threadId
            ? { ok: false, error: { id: ERROR_IDS.GMAIL_READ_INPUT_INVALID } }
            : { ok: true, value: { ...receipt, state: "applied" } },
        );
      },
    );
  markRead
    .mockReset()
    .mockImplementation((_csrf: unknown, input: { threadId: string; operationId: string }) =>
      Promise.resolve(appliedReadResult(input, true)),
    );
  markUnread
    .mockReset()
    .mockImplementation((_csrf: unknown, input: { threadId: string; operationId: string }) =>
      Promise.resolve(appliedReadResult(input, false)),
    );
  refetch.mockReset().mockImplementation(() => Promise.resolve(cachedRead()));
  freshQuery.mockReset().mockImplementation(() => Promise.resolve(readerState.data));
  setThreadData.mockReset().mockImplementation((_input: unknown, value: ReadStateData) => {
    readerState.data = value;
  });
  query.mockReset().mockImplementation(() => ({ data: readerState.data, error: null, refetch }));
  changed.mockClear();
  close.mockClear();
}
