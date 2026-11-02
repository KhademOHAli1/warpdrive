// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, configure, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { EmailTimelineMessage } from "./entityMessageReads";
import {
  privateReaderIds,
  privateReaderRead,
  privateReaderReview,
  privateReaderSummary,
  privateReaderUtils,
  resetPrivateReader,
} from "./privateIntakeReader.fixtures";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("./privateIntakeTransport.client", () => ({
  readPrivateIntakeSummary: vi.fn(),
  reviewPrivateIntakeSummary: vi.fn(),
}));
vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    useUtils: () => privateReaderUtils,
    email: { message: { get: { useQuery: (...args: unknown[]) => query(...args) } } },
  },
}));
vi.mock("./ReaderActions", () => ({ ReaderActions: () => null }));
vi.mock("./EmailCardMenu", () => ({ EmailCardMenu: () => null }));
vi.mock("./MessageBodyFrame", () => ({
  MessageBodyFrame: () => <div data-testid="original-body" />,
}));
vi.mock("@/components/shell/ActionErrorProvider", () => ({ useActionError: () => vi.fn() }));

import { EmailTimelineCard } from "./EmailTimelineCard";

beforeEach(() => {
  configure({ asyncUtilTimeout: 500 });
  resetPrivateReader();
  query.mockReturnValue({
    data: {
      messageId: privateReaderIds.message,
      accountId: privateReaderIds.account,
      ownerEmail: "owner@mail.test",
      gmailMessageId: null,
      direction: "inbound",
      fromEmail: "sender@mail.test",
      fromName: null,
      toEmails: [],
      ccEmails: [],
      subject: "محتوای خصوصی / Privater Inhalt",
      bodyHtml: "<p>Private body</p>",
      sentAt: null,
      attachments: [],
      tracking: [],
      privateIntake: privateReaderSummary,
    },
    isLoading: false,
    isError: false,
  });
});
afterEach(cleanup);

const row: EmailTimelineMessage = {
  messageId: privateReaderIds.message,
  threadId: privateReaderIds.thread,
  subject: "محتوای خصوصی / Privater Inhalt",
  sentAt: null,
  createdAt: "2026-11-01T10:00:00Z",
  direction: "inbound",
  fromEmail: "sender@mail.test",
  fromName: null,
  toEmails: [],
  snippet: "Readable private copy",
  hasAttachment: false,
  canCompose: false,
};

it.each(["conflict", "forbidden"] as const)(
  "retains fixed %s after the actual timeline is collapsed and reopened with the same cached DTO",
  async (error) => {
    privateReaderReview.mockResolvedValueOnce({ ok: false, error });
    render(
      <LocaleProvider>
        <EmailTimelineCard
          message={row}
          scope={{ kind: "deal", dealId: "deal" }}
          onUnlinked={() => {}}
        />
      </LocaleProvider>,
    );
    const user = userEvent.setup();
    expect(screen.queryByRole("region", { name: "Private email review" })).toBeNull();
    expect(screen.queryByTestId("original-body")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Expand email" }));
    await user.click(screen.getByRole("button", { name: "Review copy" }));
    await user.click(screen.getByRole("button", { name: "Keep private" }));
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Collapse email" }));
    expect(screen.queryByRole("region", { name: "Private email review" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Expand email" }));
    await user.click(screen.getByRole("button", { name: "Review copy" }));
    expect(screen.getByRole("button", { name: "Keep private" })).toBeDisabled();
    expect(privateReaderReview).toHaveBeenCalledTimes(1);
    expect(privateReaderRead).not.toHaveBeenCalled();
  },
);
