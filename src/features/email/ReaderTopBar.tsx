"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useActionError } from "@/components/shell/ActionErrorProvider";
import { useEmailMessages } from "@/features/email/useEmailMessages";
import { trpc } from "@/lib/trpc-client";
import { readCsrfToken } from "@/utils/csrfCookie";
import { trashThreadAction } from "./actions";
import { archiveThreadAction } from "./folderActions";
import type { ThreadMailCapabilities } from "./imapThreadOperationsCapabilities";
import { ImapThreadMoveDialog } from "./imapThreadOperationsDialog";
import styles from "./inboxWorkspace.module.css";
import { invalidateRecordTimelines } from "./invalidateRecordTimelines";
import { MailOperationHint } from "./MailOperationHint";
import type { NeighborFolder } from "./threadNeighbors";

// The list appends ?folder= when opening a thread; default to inbox and ignore anything else so a
// stray value never reaches the neighbors query (its input is the same three-value enum).
function readFolder(raw: string | null): NeighborFolder {
  return raw === "sent" || raw === "archive" ? raw : "inbox";
}

// Reader navigation bar (Pipedrive parity D1): a Back link, previous/next thread navigation with an
// N / total position (P3), and an Archive action. The full-page reader otherwise stranded the user
// on browser-back / the nav rail. Archive mirrors the list's per-row action, then returns to the
// inbox; a denied archive surfaces the error id instead of silently no-opping (F5-7).
// canManage: the actor owns the mailbox (canCompose). Archive and Delete are owner-only mutations,
// so a non-owner viewing a shared thread is not offered controls the backend would reject (F5-7).
export function ReaderTopBar({
  threadId,
  canManage,
  embedded = false,
  onBack,
  onChanged,
  mailCapabilities,
  mailProvider,
}: {
  threadId: string;
  canManage: boolean;
  embedded?: boolean;
  onBack?: () => void;
  onChanged?: () => void;
  mailCapabilities?: ThreadMailCapabilities;
  mailProvider?: string;
}): React.ReactNode {
  const E = useEmailMessages();

  const router = useRouter();
  const reportError = useActionError();
  const utils = trpc.useUtils();
  const folder = readFolder(useSearchParams().get("folder"));
  const { data: neighbors } = trpc.email.thread.neighbors.useQuery(
    { threadId, folder },
    { enabled: !embedded },
  );
  const [busy, setBusy] = useState(false);
  const trashInFlight = useRef(false);
  const canTrash = mailCapabilities?.trash !== false;

  // Archive/Delete both remove the thread from its list, then navigate to /inbox. The list feeds and
  // counts are cached (30s staleTime), so invalidate them or the just-removed row remounts stale.
  function invalidateFeeds(): void {
    void utils.email.inbox.list.invalidate();
    void utils.email.inbox.unreadCount.invalidate();
    void utils.email.folders.sent.invalidate();
    void utils.email.folders.archive.invalidate();
    void utils.email.search.invalidate();
    // The deal and person timelines read the linked messages separately; refresh them too so a Back
    // to the record does not render the just-trashed email from cache.
    invalidateRecordTimelines(utils);
    onChanged?.();
  }

  async function archive(): Promise<void> {
    setBusy(true);
    const res = await archiveThreadAction(readCsrfToken(), { threadId });
    setBusy(false);
    if (res.ok) {
      invalidateFeeds();
      if (embedded) onBack?.();
      else router.push("/inbox");
    } else reportError(res.error.id);
  }

  async function moveToTrash(): Promise<void> {
    if (!canManage || !canTrash || busy || trashInFlight.current) return;
    trashInFlight.current = true;
    setBusy(true);
    try {
      const res = await trashThreadAction(readCsrfToken(), { threadId });
      // A trashed thread leaves every folder. Surface an error if trash was denied or failed.
      if (!res.ok) {
        reportError(res.error.id);
        return;
      }
      invalidateFeeds();
      // Clear the cached thread and replace its URL so Back cannot reopen the trashed thread.
      void utils.email.thread.get.invalidate();
      if (embedded) onBack?.();
      else router.replace("/inbox");
    } finally {
      trashInFlight.current = false;
      setBusy(false);
    }
  }

  function goTo(id: string | null): void {
    if (id === null) return;
    router.push(`/inbox/${id}?folder=${folder}`);
  }

  const deleteButton = (
    <button
      type="button"
      disabled={busy || !canTrash}
      className="rounded-md border border-border px-3 py-1 text-sm text-destructive transition-transform hover:bg-destructive/10 active:scale-[0.96] disabled:opacity-50"
    >
      {E.delete}
    </button>
  );

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
      {embedded ? (
        <button
          type="button"
          onClick={onBack}
          aria-label={E.backToInbox}
          className={`${styles.back} items-center gap-1 rounded-md px-2 py-1 text-sm hover:bg-accent`}
        >
          <Chevron dir="left" />
          {E.back}
        </button>
      ) : (
        <Link
          href="/inbox"
          aria-label={E.backToInbox}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground transition-transform hover:bg-accent active:scale-[0.96]"
        >
          <Chevron dir="left" />
          {E.back}
        </Link>
      )}

      {/* Prev/next + position only for the mailbox owner: neighbors is null for a shared-thread
          viewer (no owner-scoped folder to walk). */}
      {!embedded && neighbors != null && (
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={E.previousConversation}
            disabled={neighbors.prevId === null}
            onClick={() => goTo(neighbors.prevId)}
            className="rounded-md p-1 text-muted-foreground transition-transform hover:bg-accent active:scale-[0.96] disabled:opacity-40"
          >
            <Chevron dir="left" />
          </button>
          <span className="tabular-nums text-xs text-muted-foreground">
            {neighbors.index} / {neighbors.total}
          </span>
          <button
            type="button"
            aria-label={E.nextConversation}
            disabled={neighbors.nextId === null}
            onClick={() => goTo(neighbors.nextId)}
            className="rounded-md p-1 text-muted-foreground transition-transform hover:bg-accent active:scale-[0.96] disabled:opacity-40"
          >
            <Chevron dir="right" />
          </button>
        </div>
      )}

      {/* B3: PD groups the reader actions top-left, adjacent to Back + pager, rather than pushing
          Archive/Delete to the far right. Archive + Delete share one action group. */}
      {canManage && (
        <div data-reader-actions-group className="flex items-center gap-1">
          <button
            type="button"
            disabled={busy}
            onClick={() => void archive()}
            className="rounded-md border border-border px-3 py-1 text-sm transition-transform hover:bg-accent active:scale-[0.96] disabled:opacity-50"
          >
            {E.archive}
          </button>

          {mailProvider === "imap_smtp" && (
            <ImapThreadMoveDialog
              key={threadId}
              threadId={threadId}
              enabled={!busy && mailCapabilities?.move === true}
              onRefresh={() => {
                invalidateFeeds();
                void utils.email.thread.get.invalidate();
              }}
              onMoved={() => {
                invalidateFeeds();
                void utils.email.thread.get.invalidate();
                if (embedded) onBack?.();
                else router.replace("/inbox");
              }}
            />
          )}

          {canTrash ? (
            <ConfirmDialog
              key={threadId}
              trigger={deleteButton}
              title={E.deleteConfirmTitle}
              description={E.deleteConfirmBody}
              cancelLabel={E.deleteCancel}
              confirmLabel={E.deleteConfirmAction}
              destructive
              pending={busy}
              onConfirm={() => void moveToTrash()}
            />
          ) : (
            <MailOperationHint enabled={false}>{deleteButton}</MailOperationHint>
          )}
        </div>
      )}
    </div>
  );
}

function Chevron({ dir }: { dir: "left" | "right" }): React.ReactNode {
  const Glyph = dir === "left" ? ChevronLeft : ChevronRight;
  return <Glyph aria-hidden="true" className="h-4 w-4" />;
}
