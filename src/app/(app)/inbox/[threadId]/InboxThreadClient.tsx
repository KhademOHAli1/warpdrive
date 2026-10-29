"use client";

import { useState } from "react";
import { ThreadPane } from "@/features/email/ThreadPane";
import { useEmailMessages } from "@/features/email/useEmailMessages";
import { useInboxRealtime } from "@/features/email/useInboxRealtime";
import type { RouterOutputs } from "@/lib/trpc-client";

interface InboxThreadClientProps {
  threadId: string;
  selfActorId: string;
  // Server-prefetched thread, forwarded to ThreadPane to seed the reader query.
  initialThread?: RouterOutputs["email"]["thread"]["get"];
}

export function InboxThreadClient({
  threadId,
  selfActorId,
  initialThread,
}: InboxThreadClientProps): React.ReactNode {
  const E = useEmailMessages();

  const [trackingBadge, setTrackingBadge] = useState<{ kind: "open" | "click" } | null>(null);

  useInboxRealtime({
    selfActorId,
    openThreadId: threadId,
    onTrackingEvent: (kind) => setTrackingBadge({ kind }),
  });

  return (
    <main aria-label={E._extra.thread} className="h-full">
      <ThreadPane threadId={threadId} trackingBadge={trackingBadge} initialThread={initialThread} />
    </main>
  );
}
