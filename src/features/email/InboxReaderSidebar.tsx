"use client";
import type React from "react";
import { Avatar } from "@/components/ui/Avatar";
import { useEmailMessages } from "@/features/email/useEmailMessages";
import { useFormatters } from "@/lib/useFormatters";
import { SidebarLinkPanel } from "./SidebarLinkPanel";

interface InboxReaderSidebarProps {
  participants: string[]; // distinct email addresses in the thread
  threadId: string;
  personId: string | null;
  personName: string | null;
  dealId: string | null;
  dealTitle: string | null;
  subject: string | null;
  // The counterparty (never the mailbox owner), derived in ThreadPane, used for the contact card
  // and the "Create new contact" prefill. Deriving it here from participants[0] would surface the
  // owner on a sent-only thread (codex review).
  primaryEmail: string | null;
  primaryName: string | null;
  canCompose: boolean;
  onLinked: () => void;
}

// Right-hand context sidebar of the Pipedrive reader: who is in the conversation, plus the
// link/create panel (search an existing person/deal to link, or create one prefilled from the
// sender and auto-link). The panel is owner-gated (canCompose), matching the mutation's backend gate.
export function InboxReaderSidebar({
  participants,
  threadId,
  personId,
  personName,
  dealId,
  dealTitle,
  subject,
  primaryEmail,
  primaryName,
  canCompose,
  onLinked,
}: InboxReaderSidebarProps): React.ReactNode {
  const E = useEmailMessages();
  const format = useFormatters();

  return (
    <aside
      aria-label={E._extra.conversation_details}
      className="w-72 shrink-0 space-y-4 border-s p-4"
    >
      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground tabular-nums">
          {format.number(participants.length)} {E._extra.people_in_this_conversation}
        </h2>
        <div className="flex flex-wrap gap-1.5">
          {participants.map((email) => (
            <Avatar key={email} name={email} className="h-7 w-7 text-[10px]" />
          ))}
        </div>
      </section>

      {primaryEmail !== null && (
        <section className="flex items-center gap-2 rounded-md border p-3">
          <Avatar name={primaryName ?? primaryEmail} className="h-8 w-8 text-xs" />
          <span className="min-w-0 truncate text-sm font-medium">
            <bdi dir="auto">{primaryName ?? primaryEmail}</bdi>
          </span>
        </section>
      )}

      <SidebarLinkPanel
        threadId={threadId}
        personId={personId}
        personName={personName}
        dealId={dealId}
        dealTitle={dealTitle}
        subject={subject}
        primaryEmail={primaryEmail}
        primaryName={primaryName}
        canEdit={canCompose}
        onLinked={onLinked}
      />
    </aside>
  );
}
