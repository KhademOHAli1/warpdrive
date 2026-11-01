"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRowSelection } from "@/components/data-table/useRowSelection";
import { INBOX_SEARCH_DEBOUNCE_MS } from "@/constants/email";
import { trpc } from "@/lib/trpc-client";
import { readCsrfToken } from "@/utils/csrfCookie";
import { DraftsList } from "./DraftsList";
import { archiveThreadAction, unarchiveThreadAction } from "./folderActions";
import { InboxConversationResults } from "./InboxConversationResults";
import { useInboxMailbox } from "./InboxMailboxContext";
import { InboxReaderStack } from "./InboxReaderStack";
import {
  type InboxNavigate,
  InboxWorkspaceHeader,
  InboxWorkspaceToolbar,
} from "./InboxWorkspaceToolbar";
import type { InboxLocation } from "./inboxLocation";
import styles from "./inboxWorkspace.module.css";
import { OutboxList } from "./OutboxList";
import { canApplySelectedMailAction } from "./privateIntakePolicy";
import { markThreadReadAction } from "./readActions";
import { NO_ATTRIBUTE_FILTER } from "./threadAttributeFilter";
import { runBulk } from "./threadBulkActions";
import { useEmailMessages } from "./useEmailMessages";
import { useInboxRealtime } from "./useInboxRealtime";

export function InboxWorkspace({
  selfActorId,
  location,
  onNavigate,
}: {
  selfActorId: string;
  location: InboxLocation;
  onNavigate: InboxNavigate;
}) {
  const E = useEmailMessages();
  const router = useRouter();
  const connected = useInboxMailbox();
  const utils = trpc.useUtils();
  const selection = useRowSelection();
  const [query, setQuery] = useState(location.query);
  const [busy, setBusy] = useState(false);
  const [hasOpenDrafts, setHasOpenDrafts] = useState(false);
  const [blockedDraftResume, setBlockedDraftResume] = useState(false);
  const [bulkError, setBulkError] = useState(false);
  const rowButtons = useRef(new Map<string, HTMLButtonElement>());
  const lastSelected = useRef<string | null>(null);
  const backed =
    location.folder === "inbox" || location.folder === "sent" || location.folder === "archive";
  useEffect(() => {
    const timer = setTimeout(() => setQuery(location.query), INBOX_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [location.query]);
  useEffect(() => {
    if (location.threadId === null && lastSelected.current !== null)
      rowButtons.current.get(lastSelected.current)?.focus({ preventScroll: true });
    if (location.threadId !== null) lastSelected.current = location.threadId;
  }, [location.threadId]);
  const feed = trpc.email.workspace.list.useInfiniteQuery(
    {
      folder: backed ? (location.folder as "inbox" | "sent" | "archive") : "inbox",
      query: location.query === "" ? "" : query,
      filter: location.filter,
      view: location.view,
      attributes: location.attributes,
    },
    { enabled: backed && connected, getNextPageParam: (last) => last.nextCursor ?? undefined },
  );
  const refresh = useCallback(() => {
    void utils.email.workspace.list.invalidate();
  }, [utils]);
  useInboxRealtime({
    selfActorId,
    openThreadId: location.threadId ?? undefined,
    onMailboxChanged: refresh,
  });
  const threads = feed.data?.pages.flatMap((page) => page.threads) ?? [];
  const total = feed.data?.pages[0]?.total ?? 0;
  const ids = threads.map((thread) => thread.id);
  const canBulkArchive = canApplySelectedMailAction(threads, selection.selected, "archive");
  const canBulkRead = canApplySelectedMailAction(threads, selection.selected, "markRead");
  const pending = feed.isPending || (location.query !== "" && location.query !== query);
  const failed = Boolean(feed.error);
  const narrowed =
    location.query !== "" ||
    location.filter !== "all" ||
    location.view !== "all" ||
    JSON.stringify(location.attributes) !== JSON.stringify(NO_ATTRIBUTE_FILTER);
  const navigate: InboxNavigate = (next, replace) => {
    selection.clear();
    setBulkError(false);
    onNavigate(next, replace);
  };
  const closeReader = () => onNavigate({ ...location, threadId: null }, true);
  const applyBulk = async (readOnly: boolean): Promise<void> => {
    if (readOnly ? !canBulkRead : !canBulkArchive) return;
    setBusy(true);
    setBulkError(false);
    try {
      const action = readOnly
        ? markThreadReadAction
        : location.folder === "archive"
          ? unarchiveThreadAction
          : archiveThreadAction;
      const failedIds = await runBulk([...selection.selected], (threadId) =>
        action(readCsrfToken(), { threadId }),
      );
      selection.clear();
      failedIds.forEach(selection.toggle);
      setBulkError(failedIds.length > 0);
      refresh();
      void utils.email.inbox.unreadCount.invalidate();
      void utils.email.inbox.list.invalidate();
      void utils.email.folders.archive.invalidate();
      void utils.email.folders.sent.invalidate();
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className={styles.workspace} aria-label={E._extra.inbox}>
      <InboxWorkspaceHeader location={location} onNavigate={navigate} />
      {blockedDraftResume && hasOpenDrafts && (
        <p role="alert" className="border-b bg-muted px-4 py-3 text-sm">
          {E.workspace.openDrafts}
        </p>
      )}
      <div className={styles.body} data-mail={backed}>
        {!backed ? (
          <div className="min-h-0 overflow-y-auto">
            {location.folder === "drafts" ? (
              <DraftsList
                onResume={(draft) => {
                  if (hasOpenDrafts) setBlockedDraftResume(true);
                  else router.push(`/inbox/compose?draft=${draft.id}`);
                }}
              />
            ) : (
              <OutboxList />
            )}
          </div>
        ) : (
          <section
            className={styles.list}
            aria-label={E._extra.conversations}
            data-reading={location.threadId !== null}
          >
            <InboxWorkspaceToolbar
              location={location}
              onNavigate={navigate}
              selected={selection.count}
              allSelected={selection.allSelected(ids)}
              onSelectAll={() => selection.toggleAll(ids)}
              onArchive={() => void applyBulk(false)}
              onMarkRead={() => void applyBulk(true)}
              onClearSelection={selection.clear}
              busy={busy}
              canArchive={canBulkArchive}
              canMarkRead={canBulkRead}
              onRefresh={refresh}
            />
            {bulkError && (
              <p role="alert" className="border-b px-3 py-2 text-xs text-destructive">
                {E._extra.bulkActionError}
              </p>
            )}
            <InboxConversationResults
              connected={connected}
              pending={pending}
              failed={failed}
              threads={threads}
              total={total}
              query={location.query}
              threadId={location.threadId}
              narrowed={narrowed}
              selection={selection}
              hasNextPage={feed.hasNextPage}
              isFetchingNextPage={feed.isFetchingNextPage}
              refresh={refresh}
              onLoadMore={() => void feed.fetchNextPage()}
              onClear={() =>
                navigate({
                  ...location,
                  query: "",
                  view: "all",
                  filter: "all",
                  attributes: NO_ATTRIBUTE_FILTER,
                })
              }
              onOpen={(threadId) => onNavigate({ ...location, threadId })}
              onButtonRef={(id, node) => {
                if (node === null) rowButtons.current.delete(id);
                else rowButtons.current.set(id, node);
              }}
            />
          </section>
        )}
        <section
          hidden={!backed}
          className={styles.readers}
          aria-label={E._extra.thread}
          data-reading={location.threadId !== null}
        >
          <InboxReaderStack
            threadId={backed ? location.threadId : null}
            onSelect={(threadId) => onNavigate({ ...location, threadId })}
            onClose={closeReader}
            onChanged={refresh}
            onComposersChange={setHasOpenDrafts}
          />
        </section>
      </div>
    </main>
  );
}
