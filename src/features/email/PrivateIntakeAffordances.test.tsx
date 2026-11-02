// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { Locale } from "@/features/i18n/registry";
import type { InboxThread } from "./emailReads";
import de from "./messages/email.de.json";
import en from "./messages/email.en.json";
import fa from "./messages/email.fa.json";
import type { PrivateIntakeSummary } from "./privateIntakeTypes";
import { ThreadList } from "./ThreadList";
import { ThreadRow } from "./ThreadRow";

const archive = vi.fn(() => Promise.resolve({ ok: true, value: { threadId: "thread" } }));
const markRead = vi.fn(() => Promise.resolve({ ok: true, value: { threadId: "thread" } }));
const markUnread = vi.fn(() => Promise.resolve({ ok: true, value: { threadId: "thread" } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/shell/ActionErrorProvider", () => ({ useActionError: () => vi.fn() }));
vi.mock("./folderActions", () => ({
  archiveThreadAction: (...args: unknown[]) => archive(...(args as [])),
  unarchiveThreadAction: (...args: unknown[]) => archive(...(args as [])),
}));
vi.mock("./readActions", () => ({
  markThreadReadAction: (...args: unknown[]) => markRead(...(args as [])),
  markThreadUnreadAction: (...args: unknown[]) => markUnread(...(args as [])),
}));
vi.mock("./threadVisibilityActions", () => ({ setThreadVisibilityAction: vi.fn() }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
vi.mock("@/lib/trpc-client", () => {
  const query = () => ({
    data: { pages: [{ threads: [], nextCursor: null }] },
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  });
  const endpoint = { invalidate: vi.fn() };
  return {
    trpc: {
      mailLabels: { list: { useQuery: () => ({ data: [] }) } },
      email: {
        inbox: { list: { useInfiniteQuery: query } },
        folders: { sent: { useInfiniteQuery: query }, archive: { useInfiniteQuery: query } },
      },
      useUtils: () => ({
        email: {
          inbox: { list: endpoint, unreadCount: endpoint },
          folders: { sent: endpoint, archive: endpoint },
          search: endpoint,
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
  unread: false,
  followUpStatus: null,
  labels: [],
  isOwner: true,
  senderEmail: null,
  senderName: null,
  snippet: null,
  hasAttachment: false,
  mailCapabilities: { read: true, send: false, markRead: false, move: false, trash: false },
};
const summary: PrivateIntakeSummary = {
  id: "11111111-1111-4111-8111-111111111111",
  revision: 4,
  state: "unverified",
  contentState: "retained",
  decision: null,
};
const protectedStates: Partial<PrivateIntakeSummary>[] = [
  {},
  { decision: "keep_private" },
  { decision: "dismiss" },
  { decision: "restore_private" },
  { state: "conflict" },
  { contentState: "purged" },
];
const copy = { en, fa, de };
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function row(thread: InboxThread, locale: Locale) {
  return render(
    <LocaleProvider locale={locale}>
      <ThreadRow
        thread={thread}
        folder="inbox"
        active={false}
        selected={false}
        onToggleSelected={vi.fn()}
        onOpen={vi.fn()}
        onArchiveDone={vi.fn()}
      />
    </LocaleProvider>,
  );
}

describe.each<Locale>(["fa", "de", "en"])("private intake affordances in %s", (locale) => {
  it.each(protectedStates)(
    "keeps protected row content readable but disables archive for %j",
    (patch) => {
      row({ ...ordinary, privateIntake: { ...summary, ...patch } }, locale);
      expect(screen.getByText(ordinary.subject ?? "")).toBeVisible();
      expect
        .soft(screen.queryByRole("button", { name: copy[locale]._extra.private_conversation }))
        .not.toBeInTheDocument();
      expect.soft(screen.getByRole("button", { name: copy[locale]._extra.archive })).toBeDisabled();
      expect.soft(screen.queryByRole("img", { name: copy[locale]._extra.private })).toBeVisible();
    },
  );

  it.each([null, { ...summary, state: "confirmed_notification" as const }])(
    "preserves ordinary or confirmed local controls with disabled remote sending",
    (privateIntake) => {
      row({ ...ordinary, privateIntake }, locale);
      expect(screen.getByRole("button", { name: copy[locale]._extra.archive })).toBeEnabled();
      expect(
        screen.getByRole("button", { name: copy[locale]._extra.private_conversation }),
      ).toBeEnabled();
    },
  );

  it("prevents a mixed bulk archive from submitting any protected copy", () => {
    render(
      <LocaleProvider locale={locale}>
        <ThreadList
          folder="inbox"
          threads={[
            ordinary,
            { ...ordinary, id: "held", subject: "Protected subject", privateIntake: summary },
          ]}
        />
      </LocaleProvider>,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: copy[locale]._extra.select_all_threads }));
    const toolbar = screen.getByRole("toolbar", { name: copy[locale]._extra.bulk_actions });
    const button = within(toolbar).getByRole("button", { name: copy[locale]._extra.archive });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(archive).not.toHaveBeenCalled();
  });

  it("keeps ordinary bulk local archive available without remote-write capability", () => {
    render(
      <LocaleProvider locale={locale}>
        <ThreadList folder="inbox" threads={[ordinary]} />
      </LocaleProvider>,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: copy[locale]._extra.select_all_threads }));
    const toolbar = screen.getByRole("toolbar", { name: copy[locale]._extra.bulk_actions });
    expect(
      within(toolbar).getByRole("button", { name: copy[locale]._extra.archive }),
    ).toBeEnabled();
  });
  it.each(["read", "unread"] as const)(
    "allows bulk local %s for a protected owner copy without enabling archive",
    async (action) => {
      render(
        <LocaleProvider locale={locale}>
          <ThreadList
            folder="inbox"
            threads={[
              {
                ...ordinary,
                privateIntake: summary,
                mailCapabilities: {
                  read: true,
                  send: false,
                  markRead: false,
                  localRead: true,
                  move: false,
                  trash: false,
                },
              },
            ]}
          />
        </LocaleProvider>,
      );
      fireEvent.click(
        screen.getByRole("checkbox", { name: copy[locale]._extra.select_all_threads }),
      );
      const toolbar = screen.getByRole("toolbar", { name: copy[locale]._extra.bulk_actions });
      expect(
        within(toolbar).getByRole("button", { name: copy[locale]._extra.archive }),
      ).toBeDisabled();
      const label =
        action === "read" ? copy[locale]._extra.mark_read : copy[locale]._extra.mark_unread;
      const button = within(toolbar).getByRole("button", { name: label });
      expect(button).toBeEnabled();
      fireEvent.click(button);
      const mutation = action === "read" ? markRead : markUnread;
      await vi.waitFor(() =>
        expect(mutation).toHaveBeenCalledWith("csrf", { threadId: ordinary.id }),
      );
      expect(archive).not.toHaveBeenCalled();
    },
  );
});
