"use client";

import { Forward, Reply, ReplyAll } from "lucide-react";
import { useEffect, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { useEmailMessages } from "@/features/email/useEmailMessages";
import { Composer } from "./composer/Composer";
import type { ComposerContext } from "./composer/composer.types";
import { buildReplyPrefill, type ReplyMode, type ReplyPrefillSourceMessage } from "./replyPrefill";

interface ReaderActionsProps {
  message: ReplyPrefillSourceMessage;
  // Mailbox address the reply/forward is sent from; excluded from reply-all recipients.
  selfEmail: string;
  accountId: string;
  threadId: string;
  onSent?: () => void;
  // Mode to open in. Omitted by the thread reader, which starts on the footer instead.
  initialMode?: ReplyMode;
  context?: ComposerContext;
  onComposerChange?: (threadId: string, open: boolean, subject?: string | null) => void;
}

// Reply / Reply all / Forward for the thread reader. Toggles which mode is active; the
// active mode renders the shared Composer pre-filled via buildReplyPrefill (pure
// recipient/subject/body derivation, unit-tested separately in replyPrefill.test.ts).
// Forward omits threadId so sending forks a new thread instead of replying into this one.
export function ReaderActions({
  message,
  selfEmail,
  accountId,
  threadId,
  onSent,
  initialMode,
  context,
  onComposerChange,
}: ReaderActionsProps): React.ReactNode {
  const E = useEmailMessages();

  const [mode, setMode] = useState<ReplyMode | null>(initialMode ?? null);
  useEffect(() => {
    onComposerChange?.(threadId, mode !== null, message.subject);
  }, [mode, threadId, onComposerChange, message.subject]);

  if (mode !== null) {
    return (
      <Composer
        accountId={accountId}
        fromAddress={selfEmail}
        threadId={mode === "forward" ? undefined : threadId}
        prefill={buildReplyPrefill(mode, message, selfEmail)}
        context={context}
        onSent={() => {
          setMode(null);
          onSent?.();
        }}
        onClose={() => setMode(null)}
      />
    );
  }

  // Persistent bordered footer card (PD parity B10): the sender avatar sits on the left, then the
  // reply / reply-all / forward affordances as glyph + label buttons. Boxed to match PD's reply
  // footer, in the same constrained column as the message cards above it.
  return (
    <div
      data-testid="reader-reply-footer"
      className="flex items-center gap-2 rounded-md border border-border bg-card p-3"
    >
      <Avatar name={message.fromEmail} className="h-7 w-7 shrink-0 text-[10px]" />
      <button
        type="button"
        onClick={() => setMode("reply")}
        className="flex items-center gap-1.5 rounded bg-action px-3 py-1 text-sm font-medium text-action-foreground transition-transform hover:opacity-90 active:scale-[0.96]"
      >
        <Reply aria-hidden="true" className="h-3.5 w-3.5" />
        {E.replyAction}
      </button>
      <button
        type="button"
        onClick={() => setMode("replyAll")}
        className="flex items-center gap-1.5 rounded border border-border px-3 py-1 text-sm text-muted-foreground transition-transform hover:bg-accent active:scale-[0.96]"
      >
        <ReplyAll aria-hidden="true" className="h-3.5 w-3.5" />
        {E.replyAllAction}
      </button>
      <button
        type="button"
        onClick={() => setMode("forward")}
        className="flex items-center gap-1.5 rounded border border-border px-3 py-1 text-sm text-muted-foreground transition-transform hover:bg-accent active:scale-[0.96]"
      >
        <Forward aria-hidden="true" className="h-3.5 w-3.5" />
        {E.forwardAction}
      </button>
    </div>
  );
}
