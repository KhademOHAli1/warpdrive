"use client";
import { CollapsibleSection } from "@/features/deal-workspace/CollapsibleSection";
import type { RouterOutputs } from "@/lib/trpc-client";
import { conversationOrder } from "./conversationOrder";
import styles from "./inboxWorkspace.module.css";
import { ReaderActions } from "./ReaderActions";
import { ReaderMessageCard } from "./ReaderMessageCard";
import { useEmailMessages } from "./useEmailMessages";

export function ReaderConversation({
  messages,
  allowRemote,
  onShowRemote,
  canCompose,
  ownerEmail,
  accountId,
  threadId,
  onSent,
  onComposerChange,
}: {
  messages: RouterOutputs["email"]["thread"]["get"]["messages"];
  allowRemote: boolean;
  onShowRemote: () => void;
  canCompose: boolean;
  ownerEmail: string;
  accountId: string;
  threadId: string;
  onSent: () => void;
  onComposerChange?: (threadId: string, open: boolean, subject?: string | null) => void;
}) {
  const E = useEmailMessages();
  const { latest: latestMessage, earlier } = conversationOrder(messages);
  return (
    <div data-reader-column className={`${styles.messageColumn} flex max-w-[44rem] flex-col gap-3`}>
      {earlier.length > 0 && (
        <CollapsibleSection
          title={E.workspace.earlierMessages(earlier.length)}
          defaultOpen={false}
          showFilter={false}
        >
          <div className="flex flex-col gap-3">
            {earlier.map((msg) => (
              <ReaderMessageCard
                key={msg.messageId}
                message={msg}
                allowRemote={allowRemote}
                onShowRemote={onShowRemote}
                accountId={accountId}
                threadId={threadId}
              />
            ))}
          </div>
        </CollapsibleSection>
      )}
      {latestMessage && (
        <ReaderMessageCard
          message={latestMessage}
          allowRemote={allowRemote}
          onShowRemote={onShowRemote}
          accountId={accountId}
          threadId={threadId}
        />
      )}

      {/* latestMessage guard is defensive: getThread only returns threads with at least
                  one email_messages row today, but nothing enforces that invariant at the DB
                  level, so this avoids handing ReaderActions an undefined message if that ever
                  changes. */}
      {canCompose && latestMessage !== undefined && (
        <ReaderActions
          message={latestMessage}
          selfEmail={ownerEmail}
          accountId={accountId}
          threadId={threadId}
          onSent={onSent}
          onComposerChange={onComposerChange}
        />
      )}
    </div>
  );
}
