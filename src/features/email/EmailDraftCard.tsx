"use client";
import type React from "react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useActionError } from "@/components/shell/ActionErrorProvider";
import { useEmailMessages } from "@/features/email/useEmailMessages";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { readCsrfToken } from "@/utils/csrfCookie";
import type { DraftSummary } from "./draftRepo";
import { deleteDraftAction } from "./folderActions";
import { formatTimelineEmailDate } from "./inboxDate";

interface EmailDraftCardProps {
  draft: DraftSummary;
  // Opens this draft in the record's composer. The host owns the composer, so the card only hands
  // the row back. Absent on a surface with no composer, where Continue is hidden rather than inert.
  onResume?: (draft: DraftSummary) => void;
  // Refetch the record's drafts after a discard.
  onChanged: () => void;
}

// One unsent draft as a record-timeline row, beside the sent messages it will join. Dashed
// border and a "Draft" badge so it never reads as something already sent.
export function EmailDraftCard({
  draft,
  onResume,
  onChanged,
}: EmailDraftCardProps): React.ReactNode {
  const E = useEmailMessages();
  const preferences = useLocalePreferences();

  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const reportError = useActionError();

  async function discard(): Promise<void> {
    setPending(true);
    const res = await deleteDraftAction(readCsrfToken(), { draftId: draft.id });
    setPending(false);
    if (!res.ok) {
      reportError(res.error.id);
      return;
    }
    onChanged();
  }

  const recipients = draft.toEmails.join(", ");
  const subject =
    draft.subject !== null && draft.subject !== "" ? draft.subject : E._extra.no_subject;

  return (
    <article className="rounded-md border border-dashed border-border bg-card">
      <div className="flex items-start justify-between gap-2 p-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
              {E._extra.draft}
            </span>
            <h3 className="truncate text-sm font-semibold text-foreground">{subject}</h3>
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            <span className="tabular-nums">
              {formatTimelineEmailDate(draft.updatedAt, undefined, preferences)}
            </span>
            {recipients !== "" && (
              <span>
                {" "}
                {E._extra.to_1e3ac}
                <bdi dir="ltr">{recipients}</bdi>
              </span>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {onResume !== undefined && (
            <button
              type="button"
              onClick={() => onResume(draft)}
              className="rounded px-2 py-1 text-xs text-muted-foreground transition-transform hover:bg-accent active:scale-[0.96]"
            >
              {E._extra.continue}
            </button>
          )}
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="rounded px-2 py-1 text-xs text-muted-foreground transition-transform hover:bg-accent active:scale-[0.96]"
          >
            {E._extra.discard}
          </button>
        </div>
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={E._extra.discard_this_draft}
        description={E._extra.the_draft_and_everything_written_in_it_are_deleted_this_cannot_be_un}
        confirmLabel={E._extra.discard_draft}
        destructive
        pending={pending}
        onConfirm={() => void discard()}
      />
    </article>
  );
}
