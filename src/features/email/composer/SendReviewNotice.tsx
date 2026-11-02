"use client";
import { useEffect, useRef } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/Button";
import type { SendEmailOutcome } from "@/types/mail";
import { sendReviewContent } from "./sendReviewContent";
import { useComposerMailboxMessages } from "./useComposerMailboxMessages";
export function SendReviewNotice({
  outcome,
  busy,
  onCheck,
  onDone,
  onKeepDraft,
  onRetry,
  onEdit,
  error,
  editOpen = false,
  onEditOpenChange,
  onConfirmEdit,
}: {
  outcome: SendEmailOutcome;
  busy: boolean;
  onCheck: () => void;
  onDone: () => void;
  onKeepDraft?: () => void;
  onRetry?: () => void;
  onEdit?: () => void;
  error?: string | null;
  editOpen?: boolean;
  onEditOpenChange?: (open: boolean) => void;
  onConfirmEdit?: () => void;
}): React.ReactNode {
  const L = useComposerMailboxMessages();
  const content = sendReviewContent(outcome, L);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  const accepted =
    outcome.status === "sent" ||
    outcome.deliveryOutcome?.state === "accepted" ||
    outcome.deliveryOutcome?.state === "partial";
  const done = accepted && outcome.messageId !== undefined;
  return (
    <div
      role="alert"
      aria-busy={busy}
      className="space-y-3 rounded-md border border-border bg-muted/30 p-3 text-sm"
    >
      <div className="space-y-1">
        <h3 ref={heading} tabIndex={-1} className="font-medium text-foreground outline-none">
          {content.title}
        </h3>
        <p className="text-pretty text-muted-foreground">{content.description}</p>
      </div>
      {(
        [
          [L.acceptedRecipients, outcome.deliveryOutcome?.accepted],
          [L.rejectedRecipients, outcome.deliveryOutcome?.rejected],
        ] as const
      ).map(
        ([label, addresses]) =>
          addresses !== undefined &&
          addresses.length > 0 && (
            <div key={label} className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">{label}</p>
              <ul className="space-y-0.5 text-xs">
                {addresses.map((address) => (
                  <li key={address}>
                    <bdi dir="ltr">{address}</bdi>
                  </li>
                ))}
              </ul>
            </div>
          ),
      )}
      {outcome.sentCopy !== undefined && (
        <p className="text-xs text-muted-foreground">
          {L.sentFolder}: <bdi>{outcome.sentCopy.folderPath}</bdi>
        </p>
      )}
      {error != null && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={busy} onClick={onCheck}>
          {busy ? L.checkingStatus : L.checkStatus}
        </Button>
        {outcome.status === "failed" && onRetry !== undefined && (
          <Button variant="outline" size="sm" disabled={busy} onClick={onRetry}>
            {L.retrySend}
          </Button>
        )}
        {onEdit !== undefined && (
          <Button variant="outline" size="sm" disabled={busy} onClick={onEdit}>
            {L.editDraft}
          </Button>
        )}
        {done ? (
          <Button size="sm" disabled={busy} onClick={onDone}>
            {L.done}
          </Button>
        ) : (
          onKeepDraft !== undefined && (
            <Button variant="ghost" size="sm" disabled={busy} onClick={onKeepDraft}>
              {L.closeKeepDraft}
            </Button>
          )
        )}
      </div>
      {onEditOpenChange !== undefined && onConfirmEdit !== undefined && (
        <ConfirmDialog
          open={editOpen}
          onOpenChange={onEditOpenChange}
          title={L.editTitle}
          description={L.editDescription}
          confirmLabel={L.editDraft}
          cancelLabel={L.cancel}
          pending={busy}
          onConfirm={onConfirmEdit}
        />
      )}
    </div>
  );
}
