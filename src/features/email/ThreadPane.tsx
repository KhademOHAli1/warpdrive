"use client";

import { PanelRightOpen } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/Popover";
import { useEmailMessages } from "@/features/email/useEmailMessages";
import { type RouterOutputs, trpc } from "@/lib/trpc-client";
import { readCsrfToken } from "@/utils/csrfCookie";
import { InboxReaderSidebar } from "./InboxReaderSidebar";
import styles from "./inboxWorkspace.module.css";
import { invalidateRecordTimelines } from "./invalidateRecordTimelines";
import { MailOperationHint } from "./MailOperationHint";
import { primaryCounterparty } from "./primaryCounterparty";
import { ReaderConversation } from "./ReaderConversation";
import { ReaderTopBar } from "./ReaderTopBar";
import { markThreadReadAction, markThreadUnreadAction } from "./readActions";
import { ThreadFollowUpControls } from "./ThreadFollowUpControls";
import { ThreadPrivacyToggle } from "./ThreadPrivacyToggle";

interface ThreadPaneProps {
  threadId: string;
  embedded?: boolean;
  active?: boolean;
  onClose?: () => void;
  onChanged?: () => void;
  onComposerChange?: (threadId: string, open: boolean, subject?: string | null) => void;
  // trackingBadge: set by the parent route wrapper when a live WS email_tracking event
  // arrives for this thread. Transient only (current session), a real-time nudge. The
  // persisted per-message history (source of record, survives reload) is rendered per
  // message below via MessageTrackingHistory, fed by message.tracking.
  trackingBadge: { kind: "open" | "click" } | null;
  // Server-prefetched thread (allowRemote:false) so the reader paints without a client round trip.
  initialThread?: RouterOutputs["email"]["thread"]["get"];
}

export function ThreadPane({
  threadId,
  trackingBadge,
  initialThread,
  embedded = false,
  active = true,
  onClose,
  onChanged,
  onComposerChange,
}: ThreadPaneProps): React.ReactNode {
  const E = useEmailMessages();

  const [allowRemote, setAllowRemote] = useState(false);
  const { data, error, refetch } = trpc.email.thread.get.useQuery(
    { threadId, allowRemote },
    // Seed only the initial (allowRemote:false) key with the server prefetch; toggling remote
    // images fires a fresh fetch. useInboxRealtime still invalidates on inbound events.
    { initialData: allowRemote === false ? initialThread : undefined },
  );
  const ready = data !== undefined;
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (embedded && active && ready) titleRef.current?.focus({ preventScroll: true });
  }, [embedded, active, ready]);
  const utils = trpc.useUtils();
  // Guards mark-read-on-open to fire once per thread: re-renders (e.g. from a Composer send
  // triggering refetch()) share the same threadId and must not re-fire the action.
  const markedReadForThreadId = useRef<string | null>(null);
  const [markUnreadError, setMarkUnreadError] = useState<string | null>(null);

  useEffect(() => {
    if (data === undefined) return;
    if (data.mailCapabilities?.markRead === false) return;
    if (markedReadForThreadId.current === threadId) return;
    markedReadForThreadId.current = threadId;
    void markThreadReadAction(readCsrfToken(), { threadId }).then((res) => {
      // Silent on failure (best-effort background call): only invalidate on success so a
      // permission/CSRF failure doesn't mask itself behind a cache that looks refreshed.
      // Invalidate both queries, mirroring handleMarkUnread below: ThreadRow reads its
      // unread dot/bold from the cached inbox.list query, not unreadCount, so invalidating
      // only unreadCount left the just-opened row looking unread in the list.
      if (res.ok) {
        void utils.email.inbox.list.invalidate();
        void utils.email.inbox.unreadCount.invalidate();
        onChanged?.();
      }
    });
  }, [data, threadId, utils, onChanged]);

  // A reply sent here and a change to the thread's linked deal/person both alter what the deal and
  // person timelines should show, and those queries live on other routes: refetching the thread
  // alone leaves them serving stale cards for the rest of their stale window.
  function handleThreadChanged(): void {
    invalidateRecordTimelines(utils);
    void refetch();
    onChanged?.();
  }

  async function handleMarkUnread(): Promise<void> {
    if (data?.mailCapabilities?.markRead === false) return;
    const res = await markThreadUnreadAction(readCsrfToken(), { threadId });
    if (!res.ok) {
      setMarkUnreadError(E.errorMarkUnread);
      return;
    }
    setMarkUnreadError(null);
    void utils.email.inbox.list.invalidate();
    void utils.email.inbox.unreadCount.invalidate();
    onChanged?.();
  }

  if (data === undefined) {
    return (
      <div className={styles.state} role={error ? "alert" : "status"}>
        <p>{error ? E.workspace.threadError : E._extra.loading}</p>
        {error && (
          <Button variant="outline" onClick={() => void refetch()}>
            {E.workspace.retry}
          </Button>
        )}
        {onClose && (
          <Button variant="ghost" onClick={onClose}>
            {E.backToInbox}
          </Button>
        )}
      </div>
    );
  }

  const { messages, accountId, canCompose, ownerEmail, personName, dealTitle } = data;
  const inboxThread = data.thread;
  // Newest-first order (getThread), so the first message is what Reply/Reply all/Forward
  // should act on.
  // Distinct sender addresses = the people in this conversation (Pipedrive's right sidebar).
  const participants = [...new Set(messages.map((m) => m.fromEmail).filter((e) => e !== ""))];
  // The counterparty (never the mailbox owner) seeds the "Create new contact" prefill. Using the
  // first sender would prefill the owner's own address on a sent-only thread (codex review).
  const counterparty = primaryCounterparty(messages, ownerEmail);
  const primaryEmail = counterparty?.email ?? null;
  const primaryName = counterparty?.name ?? null;

  const followUpControls = canCompose && (
    <ThreadFollowUpControls
      threadId={inboxThread.id}
      followUpStatus={inboxThread.followUpStatus}
      labels={inboxThread.labels}
      onChanged={handleThreadChanged}
    />
  );
  const sidebar = (
    <InboxReaderSidebar
      participants={participants}
      threadId={inboxThread.id}
      personId={inboxThread.personId}
      personName={personName}
      dealId={inboxThread.dealId}
      dealTitle={dealTitle}
      subject={inboxThread.subject}
      primaryEmail={primaryEmail}
      primaryName={primaryName}
      canCompose={canCompose && data.mailCapabilities?.send !== false}
      onLinked={handleThreadChanged}
    />
  );

  return (
    <div className={styles.reader}>
      <ReaderTopBar
        threadId={inboxThread.id}
        canManage={canCompose}
        mailCapabilities={data.mailCapabilities}
        mailProvider={data.mailProvider}
        embedded={embedded}
        onBack={onClose}
        onChanged={onChanged}
      />
      <header className="px-4 py-3 border-b border-border">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h1
            ref={titleRef}
            tabIndex={-1}
            className="min-w-0 break-words text-base font-semibold text-foreground text-balance"
          >
            {inboxThread.subject ?? E._extra.no_subject}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            {markUnreadError !== null && (
              <p className="text-xs text-destructive">{markUnreadError}</p>
            )}
            {/* Owner-only thread privacy (B2). Same canCompose gate as the follow-up controls: only
                the mailbox owner may flip visibility, and the server re-checks ownership. Reuses the
                shared ThreadPrivacyToggle (also used per-row in ThreadList), which surfaces a failed
                flip through the app-wide ActionError provider. */}
            {canCompose && (
              <ThreadPrivacyToggle
                threadId={inboxThread.id}
                visibility={inboxThread.visibility}
                onChanged={handleThreadChanged}
              />
            )}
            {embedded && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm">
                    <PanelRightOpen aria-hidden="true" className="size-4" />
                    {E.workspace.details}
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  className="max-h-[min(32rem,70vh)] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto p-0"
                >
                  <h2 className="border-b px-4 py-3 text-sm font-semibold">
                    {E._extra.conversation_details}
                  </h2>
                  {canCompose && <div className="border-b p-4">{followUpControls}</div>}
                  {sidebar}
                </PopoverContent>
              </Popover>
            )}
            <MailOperationHint enabled={data.mailCapabilities?.markRead !== false}>
              <button
                type="button"
                disabled={data.mailCapabilities?.markRead === false}
                onClick={() => void handleMarkUnread()}
                className="shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground transition-transform hover:bg-accent active:scale-[0.96]"
              >
                {E.markAsUnread}
              </button>
            </MailOperationHint>
          </div>
        </div>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {inboxThread.personId !== null && (
            <a
              href={`/contacts/people/${inboxThread.personId}`}
              className="inline-block max-w-[12rem] truncate px-2 py-0.5 rounded-full bg-accent text-accent-foreground text-xs hover:underline"
            >
              {/* Pipedrive labels the chip with the linked record's NAME, not the type noun. */}
              {personName ?? E.linkedPersonFallback}
            </a>
          )}
          {inboxThread.dealId !== null && (
            <a
              href={`/deals/${inboxThread.dealId}`}
              className="inline-block max-w-[12rem] truncate px-2 py-0.5 rounded-full bg-accent text-accent-foreground text-xs hover:underline"
            >
              {dealTitle ?? E.linkedDealFallback}
            </a>
          )}
          {trackingBadge !== null && (
            <span className="inline-block px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-xs">
              {trackingBadge.kind === "open" ? E._extra.opened : E._extra.clicked}
            </span>
          )}
        </div>
        {/* Label + follow-up mutations are gated server-side on mailbox ownership (same predicate
            as canCompose). Only offer the controls when the user owns the mailbox, so we never
            present a clickable control the backend will reject (F5-7). */}
        {!embedded && <div className="mt-2">{followUpControls}</div>}
      </header>

      <div className={styles.readerBody}>
        {/* Message list + composer (center); conversation context (right). */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* B8: the reply footer lives INSIDE this scroller (as the last child of the constrained
              column), so it flows immediately under the last message instead of floating at the page
              bottom below a flex-1 spacer. B10: the column is width-constrained and centered, with
              each message + the reply footer as its own bordered card. */}
          <div data-reader-scroll className="flex-1 overflow-y-auto">
            <ReaderConversation
              messages={messages}
              allowRemote={allowRemote}
              onShowRemote={() => setAllowRemote(true)}
              canCompose={canCompose && data.mailCapabilities?.send !== false}
              ownerEmail={ownerEmail}
              accountId={accountId}
              threadId={threadId}
              onSent={handleThreadChanged}
              onComposerChange={onComposerChange}
            />
          </div>
        </div>

        {!embedded && sidebar}
      </div>
    </div>
  );
}
