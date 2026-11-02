"use client";
import { useComposerMailboxMessages } from "./useComposerMailboxMessages";
export function GmailConnectionNotice({ reason }: { reason?: string }): React.ReactNode {
  const L = useComposerMailboxMessages();
  const descriptions: Record<string, string> = {
    fresh_auth_required: L.connectFreshAuth,
    permission: L.connectPermission,
    stale_state: L.connectExpired,
    revocation_pending: L.connectRevocation,
  };
  const description =
    reason !== undefined && Object.hasOwn(descriptions, reason)
      ? descriptions[reason]
      : L.connectFailed;
  return (
    <div role="alert" className="shrink-0 border-b border-border bg-muted/30 px-4 py-3 text-sm">
      <p className="text-pretty text-foreground">{description}</p>
      <a
        href="/settings/email-sync"
        className="mt-1 inline-block font-medium text-action hover:underline"
      >
        {L.openConnections}
      </a>
    </div>
  );
}
