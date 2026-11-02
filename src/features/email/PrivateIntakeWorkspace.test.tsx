// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { Locale } from "@/features/i18n/registry";
import type { InboxThread } from "./emailReads";
import { InboxWorkspace } from "./InboxWorkspace";
import type { InboxLocation } from "./inboxLocation";
import de from "./messages/email.de.json";
import en from "./messages/email.en.json";
import fa from "./messages/email.fa.json";
import { NO_ATTRIBUTE_FILTER } from "./threadAttributeFilter";

type MailAction = (...args: unknown[]) => Promise<{ ok: true; value: { threadId: string } }>;
const archive = vi
  .fn<MailAction>()
  .mockResolvedValue({ ok: true, value: { threadId: "ordinary" } });
const markRead = vi
  .fn<MailAction>()
  .mockResolvedValue({ ok: true, value: { threadId: "ordinary" } });
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("./folderActions", () => ({
  archiveThreadAction: (...args: unknown[]) => archive(...args),
  unarchiveThreadAction: (...args: unknown[]) => archive(...args),
}));
vi.mock("./readActions", () => ({
  markThreadReadAction: (...args: unknown[]) => markRead(...args),
}));
vi.mock("./InboxMailboxContext", () => ({ useInboxMailbox: () => true }));
vi.mock("./useInboxRealtime", () => ({ useInboxRealtime: vi.fn() }));
vi.mock("./InboxReaderStack", () => ({ InboxReaderStack: () => null }));
vi.mock("./DraftsList", () => ({ DraftsList: () => null }));
vi.mock("./OutboxList", () => ({ OutboxList: () => null }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
vi.mock("@/lib/trpc-client", () => {
  const endpoint = { invalidate: vi.fn() };
  return {
    trpc: {
      email: {
        workspace: {
          list: {
            useInfiniteQuery: () => ({
              data: { pages: [{ threads, total: threads.length, nextCursor: null }] },
              isPending: false,
              hasNextPage: false,
              isFetchingNextPage: false,
              fetchNextPage: vi.fn(),
            }),
          },
        },
      },
      useUtils: () => ({
        email: {
          workspace: { list: endpoint },
          inbox: { list: endpoint, unreadCount: endpoint },
          folders: { archive: endpoint, sent: endpoint },
        },
      }),
    },
  };
});

const ordinary: InboxThread = {
  id: "ordinary",
  subject: "Original subject",
  lastMessageAt: null,
  personId: null,
  dealId: null,
  visibility: "private",
  unread: true,
  followUpStatus: null,
  labels: [],
  isOwner: true,
  senderEmail: null,
  senderName: null,
  snippet: null,
  hasAttachment: false,
  mailCapabilities: { read: true, send: false, markRead: true, move: false, trash: false },
};
let threads: InboxThread[] = [];
const location: InboxLocation = {
  folder: "inbox",
  threadId: null,
  query: "",
  view: "all",
  filter: "all",
  attributes: NO_ATTRIBUTE_FILTER,
};
const copy = { fa, de, en };
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe.each<Locale>(["fa", "de", "en"])("workspace mutation gates in %s", (locale) => {
  function workspace() {
    return render(
      <LocaleProvider locale={locale}>
        <InboxWorkspace selfActorId="owner" location={location} onNavigate={vi.fn()} />
      </LocaleProvider>,
    );
  }
  function selectAll() {
    fireEvent.click(screen.getByRole("checkbox", { name: copy[locale]._extra.select_all_threads }));
    return screen.getByRole("toolbar", { name: copy[locale].workspace.selection });
  }
  it("disables archive and remote read for a mixed protected selection", () => {
    threads = [
      ordinary,
      {
        ...ordinary,
        id: "held",
        subject: "Protected subject",
        privateIntake: {
          id: "11111111-1111-4111-8111-111111111111",
          revision: 2,
          state: "unverified",
          contentState: "retained",
          decision: "dismiss",
        },
        mailCapabilities: { read: true, send: false, markRead: false, move: false, trash: false },
      },
    ];
    workspace();
    const bar = selectAll();
    const archiveButton = within(bar).getByRole("button", { name: copy[locale].workspace.archive });
    const readButton = within(bar).getByRole("button", { name: copy[locale].workspace.markRead });
    expect.soft(archiveButton).toBeDisabled();
    expect.soft(readButton).toBeDisabled();
    fireEvent.click(archiveButton);
    fireEvent.click(readButton);
    expect(archive).not.toHaveBeenCalled();
    expect(markRead).not.toHaveBeenCalled();
  });
  it("retains ordinary local archive while remote read is unavailable", () => {
    threads = [
      {
        ...ordinary,
        mailCapabilities: { read: true, send: false, markRead: false, move: false, trash: false },
      },
    ];
    workspace();
    const bar = selectAll();
    expect(within(bar).getByRole("button", { name: copy[locale].workspace.archive })).toBeEnabled();
    expect(
      within(bar).getByRole("button", { name: copy[locale].workspace.markRead }),
    ).toBeDisabled();
  });
  it.each(["unverified", "conflict"] as const)(
    "allows the owner's local read action for a %s protected copy",
    async (state) => {
      threads = [
        ordinary,
        {
          ...ordinary,
          id: "held",
          privateIntake: {
            id: "11111111-1111-4111-8111-111111111111",
            revision: 2,
            state,
            contentState: "retained",
            decision: "keep_private",
          },
          mailCapabilities: {
            read: true,
            send: false,
            markRead: false,
            localRead: true,
            move: false,
            trash: false,
          },
        },
      ];
      workspace();
      const bar = selectAll();
      expect(
        within(bar).getByRole("button", { name: copy[locale].workspace.archive }),
      ).toBeDisabled();
      const button = within(bar).getByRole("button", { name: copy[locale].workspace.markRead });
      expect(button).toBeEnabled();
      fireEvent.click(button);
      await vi.waitFor(() => expect(markRead).toHaveBeenCalledTimes(2));
      expect(markRead).toHaveBeenCalledWith("csrf", { threadId: "held" });
      expect(archive).not.toHaveBeenCalled();
    },
  );
  it("preserves ordinary remote-read controls when permitted", () => {
    threads = [ordinary];
    workspace();
    const bar = selectAll();
    expect(within(bar).getByRole("button", { name: copy[locale].workspace.archive })).toBeEnabled();
    expect(
      within(bar).getByRole("button", { name: copy[locale].workspace.markRead }),
    ).toBeEnabled();
  });
  it("does not submit selected rows that disappeared from the refreshed page", () => {
    threads = [ordinary];
    const view = workspace();
    selectAll();
    threads = [];
    view.rerender(
      <LocaleProvider locale={locale}>
        <InboxWorkspace selfActorId="owner" location={location} onNavigate={vi.fn()} />
      </LocaleProvider>,
    );
    const bar = screen.getByRole("toolbar", { name: copy[locale].workspace.selection });
    expect(
      within(bar).getByRole("button", { name: copy[locale].workspace.archive }),
    ).toBeDisabled();
    expect(
      within(bar).getByRole("button", { name: copy[locale].workspace.markRead }),
    ).toBeDisabled();
  });
});
