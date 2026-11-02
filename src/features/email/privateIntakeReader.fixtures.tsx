import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { Locale } from "@/features/i18n/registry";
import {
  readPrivateIntakeSummary,
  reviewPrivateIntakeSummary,
} from "./privateIntakeTransport.client";
import type { PrivateIntakeSummary } from "./privateIntakeTypes";
import { ReaderPrivateIntake } from "./ReaderPrivateIntake";

export const privateReaderIds = {
  account: "61c44585-1398-4e5a-abd0-d9c57fd3e001",
  otherAccount: "61c44585-1398-4e5a-abd0-d9c57fd3e002",
  message: "61c44585-1398-4e5a-abd0-d9c57fd3e003",
  thread: "61c44585-1398-4e5a-abd0-d9c57fd3e004",
  intake: "61c44585-1398-4e5a-abd0-d9c57fd3e005",
  otherIntake: "61c44585-1398-4e5a-abd0-d9c57fd3e006",
};
export const privateReaderSummary: PrivateIntakeSummary = {
  id: privateReaderIds.intake,
  revision: 4,
  state: "unverified",
  contentState: "retained",
  decision: null,
};
export const privateReaderRead = vi.mocked(readPrivateIntakeSummary);
export const privateReaderReview = vi.mocked(reviewPrivateIntakeSummary);
export const privateReaderInvalidate = vi.fn(() => Promise.resolve());
const endpoint = { invalidate: privateReaderInvalidate };
export const privateReaderUtils = {
  email: {
    thread: { get: endpoint },
    message: { get: endpoint },
    inbox: { list: endpoint, unreadCount: endpoint },
    folders: { sent: endpoint, archive: endpoint },
    search: endpoint,
    listMessagesForDeal: endpoint,
    listMessagesForContact: endpoint,
  },
};
export function resetPrivateReader() {
  privateReaderRead.mockReset().mockResolvedValue({ ok: true, value: privateReaderSummary });
  privateReaderReview.mockReset().mockImplementation((raw) => {
    const input = raw as {
      intakeId: string;
      expectedRevision: number;
      decision: "keep_private" | "dismiss" | "restore_private";
    };
    return Promise.resolve({
      ok: true,
      value: {
        ...privateReaderSummary,
        id: input.intakeId,
        revision: input.expectedRevision + 1,
        decision: input.decision,
      },
    });
  });
  privateReaderInvalidate.mockClear();
}
export function renderPrivateReader(
  patch: Partial<Parameters<typeof ReaderPrivateIntake>[0]> = {},
  locale: Locale = "en",
) {
  let props: Parameters<typeof ReaderPrivateIntake>[0] = {
    accountId: privateReaderIds.account,
    messageId: privateReaderIds.message,
    threadId: privateReaderIds.thread,
    summary: privateReaderSummary,
    ...patch,
  };
  let hidden = false;
  const tree = () => (
    <LocaleProvider locale={locale}>
      <div hidden={hidden} inert={hidden}>
        <ReaderPrivateIntake {...props} />
      </div>
    </LocaleProvider>
  );
  const view = render(tree());
  return {
    ...view,
    user: userEvent.setup(),
    update: (next: Partial<typeof props>) => {
      props = { ...props, ...next };
      view.rerender(tree());
    },
    hide: () => {
      hidden = true;
      view.rerender(tree());
    },
    show: () => {
      hidden = false;
      view.rerender(tree());
    },
  };
}
