"use client";
import { useState } from "react";
import { useActionError } from "@/components/shell/ActionErrorProvider";
import { ROW_ACTION_BUTTON } from "@/constants/formStyles";
import { useEmailMessages } from "@/features/email/useEmailMessages";
import { trpc } from "@/lib/trpc-client";
import { useFormatters } from "@/lib/useFormatters";
import { readCsrfToken } from "@/utils/csrfCookie";
import type { DraftSummary } from "./draftRepo";
import { deleteDraftAction } from "./folderActions";

export function DraftsList({
  onResume,
}: {
  onResume: (draft: DraftSummary) => void;
}): React.ReactNode {
  const E = useEmailMessages();
  const format = useFormatters();

  const utils = trpc.useUtils();
  const { data: drafts = [] } = trpc.email.drafts.list.useQuery();
  const [busyId, setBusyId] = useState<string | null>(null);
  const reportError = useActionError();

  async function remove(id: string): Promise<void> {
    setBusyId(id);
    const res = await deleteDraftAction(readCsrfToken(), { draftId: id });
    setBusyId(null);
    if (res.ok) void utils.email.drafts.list.invalidate();
    else reportError(res.error.id);
  }

  if (drafts.length === 0) {
    return <div className="p-4 text-sm text-muted-foreground">{E._extra.no_saved_drafts}</div>;
  }
  return (
    <ul className="divide-y">
      {drafts.map((d) => (
        <li key={d.id} className="flex items-start justify-between gap-2 p-3">
          <button type="button" onClick={() => onResume(d)} className="min-w-0 flex-1 text-start">
            <p className="truncate text-sm font-medium">
              {d.subject !== null && d.subject !== "" ? d.subject : E._extra.no_subject}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              <bdi dir="ltr">{d.toEmails.join(", ")}</bdi>
            </p>
            <p className="text-xs text-muted-foreground tabular-nums">
              {format.dateTime(d.updatedAt)}
            </p>
          </button>
          <button
            type="button"
            disabled={busyId === d.id}
            onClick={() => void remove(d.id)}
            className={ROW_ACTION_BUTTON}
          >
            {E._extra.delete}
          </button>
        </li>
      ))}
    </ul>
  );
}
