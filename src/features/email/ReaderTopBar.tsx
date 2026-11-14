"use client";

import { ChevronLeft } from "lucide-react";
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
// Archive and Delete are owner-only mutations. The workspace closes the reader and restores
// the list context after a successful operation.
export function ReaderTopBar({
  threadId,
  canManage,
  onBack,
  onChanged,
  mailCapabilities,
  mailProvider,
}: {
  threadId: string;
  canManage: boolean;
  onBack?: () => void;
  onChanged?: () => void;
  mailCapabilities?: ThreadMailCapabilities;
  mailProvider?: string;
}): React.ReactNode {
  const E = useEmailMessages();

  const reportError = useActionError();
  const utils = trpc.useUtils();
  const [busy, setBusy] = useState(false);
  const trashInFlight = useRef(false);
  const canTrash = mailCapabilities?.trash !== false;

  // Archive/Delete both remove the thread from its list. Invalidate cached feeds and counts
  // before the workspace closes the reader.
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
      onBack?.();
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
      // Clear the cached thread before closing so Back cannot reopen stale reader data.
      void utils.email.thread.get.invalidate();
      onBack?.();
    } finally {
      trashInFlight.current = false;
      setBusy(false);
    }
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
      <button
        type="button"
        onClick={onBack}
        aria-label={E.backToInbox}
        className={`${styles.back} items-center gap-1 rounded-md px-2 py-1 text-sm hover:bg-accent`}
      >
        <ChevronLeft aria-hidden="true" className="h-4 w-4" />
        {E.back}
      </button>

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
                onBack?.();
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
