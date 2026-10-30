"use client";
import { Lock, Paperclip } from "lucide-react";
import type { Ref } from "react";
import { Checkbox } from "@/components/ui/Checkbox";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { MASK_CLASS } from "@/features/observability/replayMasking";
import type { InboxThread } from "./emailReads";
import { formatInboxListDate } from "./inboxDate";
import styles from "./inboxWorkspace.module.css";
import { decodeEmailSnippet } from "./snippetText";
import { useEmailMessages } from "./useEmailMessages";

export function InboxConversationRow({
  thread,
  active,
  selected,
  onSelect,
  onOpen,
  buttonRef,
}: {
  thread: InboxThread;
  active: boolean;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
}) {
  const E = useEmailMessages();
  const preferences = useLocalePreferences();
  const subject = thread.subject ?? E._extra.no_subject;
  return (
    <li className={styles.row} data-active={active}>
      <div className="pt-0.5">
        <Checkbox
          label={E._extra.select_arg0(subject)}
          checked={selected}
          onCheckedChange={onSelect}
        />
      </div>
      <button
        ref={buttonRef}
        type="button"
        className={styles.openRow}
        onClick={onOpen}
        aria-current={active ? "true" : undefined}
      >
        <div className={styles.rowTop}>
          <span className={`truncate text-sm ${thread.unread ? "font-semibold" : "font-medium"}`}>
            <bdi dir="auto">{thread.senderName ?? thread.senderEmail ?? subject}</bdi>
          </span>
          <time className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
            {formatInboxListDate(thread.lastMessageAt, undefined, preferences)}
          </time>
        </div>
        <p className={`truncate text-sm ${thread.unread ? "font-semibold" : ""}`}>
          {thread.unread && (
            <span
              className="me-1.5 inline-block size-1.5 rounded-full bg-primary"
              role="img"
              aria-label={E.workspace.unread}
            />
          )}
          <bdi dir="auto">{subject}</bdi>
        </p>
        <p className={`${MASK_CLASS} mt-1 truncate text-xs text-muted-foreground`}>
          <bdi dir="auto">{decodeEmailSnippet(thread.snippet ?? "")}</bdi>
        </p>
        <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
          {thread.followUpStatus === "waiting" && (
            <span className="rounded bg-muted px-1.5 py-0.5">{E.workspace.waiting}</span>
          )}
          {thread.hasAttachment && (
            <Paperclip role="img" aria-label={E.hasAttachmentLabel} className="size-3.5" />
          )}
          {thread.visibility === "private" && (
            <Lock role="img" aria-label={E._extra.private} className="size-3.5" />
          )}
          {thread.labels.slice(0, 2).map((label) => (
            <span key={label} className="truncate rounded bg-muted px-1.5 py-0.5">
              {Object.entries(E.labelNames).find(([key]) => key === label)?.[1] ?? label}
            </span>
          ))}
        </div>
      </button>
    </li>
  );
}
