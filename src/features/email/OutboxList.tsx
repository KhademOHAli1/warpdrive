"use client";
import { useState } from "react";
import { useActionError } from "@/components/shell/ActionErrorProvider";
import { ROW_ACTION_BUTTON } from "@/constants/formStyles";
import { useEmailMessages } from "@/features/email/useEmailMessages";
import { trpc } from "@/lib/trpc-client";
import { useFormatters } from "@/lib/useFormatters";
import { readCsrfToken } from "@/utils/csrfCookie";
import { sendFailureMessage } from "./composer/sendFailure";
import { cancelOutboxAction } from "./folderActions";

// A pending or future-scheduled row is cancelable (unsent + unclaimed). A row a worker has
// picked up ("sending") or parked ("needs_review") is NOT: the server refuses those, so the
// button must not appear even when a future scheduledAt is set.
function isCancelable(status: string, scheduledAt: string | null): boolean {
  if (status === "sending" || status === "needs_review") return false;
  return status === "pending" || scheduledAt !== null;
}

export function OutboxList(): React.ReactNode {
  const E = useEmailMessages();
  const format = useFormatters();
  function statusLabel(status: string, scheduledAt: string | null): string {
    if (scheduledAt !== null) return E._extra.scheduled(format.dateTime(scheduledAt));
    if (status === "needs_review") return E._extra.needsReview;
    if (status === "sending") return E._extra.sending;
    return E._extra.queued;
  }

  const utils = trpc.useUtils();
  const { data: items = [] } = trpc.email.folders.outbox.useQuery();
  const [busyId, setBusyId] = useState<string | null>(null);
  const reportError = useActionError();

  async function cancel(id: string): Promise<void> {
    setBusyId(id);
    const res = await cancelOutboxAction(readCsrfToken(), { attemptId: id });
    setBusyId(null);
    if (res.ok) void utils.email.folders.outbox.invalidate();
    else reportError(res.error.id);
  }

  if (items.length === 0) {
    return (
      <div className="p-4 text-sm text-muted-foreground">{E._extra.nothing_queued_to_send}</div>
    );
  }
  return (
    <ul className="divide-y">
      {items.map((it) => (
        <li key={it.id} className="flex items-start justify-between gap-2 p-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{it.subject ?? E._extra.no_subject}</p>
            <p className="truncate text-xs text-muted-foreground">
              <bdi dir="ltr">{it.to.join(", ")}</bdi>
            </p>
            <p className="text-xs text-muted-foreground tabular-nums">
              {statusLabel(it.status, it.scheduledAt)}
            </p>
            {it.errorId !== null && (
              <p className="text-xs text-destructive">
                {it.status === "needs_review"
                  ? E._composer.sendUnconfirmed
                  : sendFailureMessage(it.errorId, E)}
              </p>
            )}
          </div>
          {isCancelable(it.status, it.scheduledAt) ? (
            <button
              type="button"
              disabled={busyId === it.id}
              onClick={() => void cancel(it.id)}
              className={ROW_ACTION_BUTTON}
            >
              {E._extra.cancel}
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
