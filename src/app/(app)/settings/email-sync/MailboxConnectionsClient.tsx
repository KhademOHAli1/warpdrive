"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { connectGmailStart } from "@/features/email/actions";
import {
  checkMailboxConnection,
  listMailboxConnections,
  mutateMailboxConnection,
  saveMailboxConnection,
} from "@/features/email/connections/api";
import { MailboxConnectionsPanel } from "@/features/email/connections/MailboxConnectionsPanel";
import { MailboxFreshAuthDialog } from "@/features/email/connections/MailboxFreshAuthDialog";
import { mailboxConnectionMessages } from "@/features/email/connections/messages";
import type {
  MailboxConnectionActions,
  MailboxConnectionView,
} from "@/features/email/connections/types";
import { MailboxConnectionFeedback } from "@/features/email/connections/useMailboxConnectionTask";
import { useMailboxRefresh } from "@/features/email/connections/useMailboxRefresh";
import { useLocale } from "@/features/i18n/LocaleProvider";

const actions: MailboxConnectionActions = {
  check: checkMailboxConnection,
  save: saveMailboxConnection,
  mutate: mutateMailboxConnection,
  connectGmail: async (signal) => {
    signal.throwIfAborted();
    const { url } = await connectGmailStart();
    signal.throwIfAborted();
    const destination = new URL(url);
    if (
      destination.origin !== "https://accounts.google.com" ||
      destination.username ||
      destination.password
    )
      return { ok: false, error: "unknown" };
    window.location.assign(destination.href);
    return { ok: true, value: undefined };
  },
};

export function MailboxConnectionsClient({
  initialMailboxes,
  gmailAvailable,
}: {
  initialMailboxes: MailboxConnectionView[];
  gmailAvailable: boolean;
}) {
  const L = mailboxConnectionMessages(useLocale());
  const [mailboxes, setMailboxes] = useState(initialMailboxes);
  const [freshAuthOpen, setFreshAuthOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const refresh = useMailboxRefresh(listMailboxConnections, setMailboxes);
  return (
    <div className="space-y-4">
      <MailboxConnectionsPanel
        mailboxes={mailboxes}
        actions={actions}
        gmailAvailable={gmailAvailable}
        onChanged={refresh.reload}
        onRequireFreshAuth={() => {
          setConfirmed(false);
          setFreshAuthOpen(true);
        }}
      />
      {refresh.busy && (
        <p role="status" className="text-sm text-muted-foreground">
          {L.refreshing}
        </p>
      )}
      <MailboxConnectionFeedback
        error={refresh.error}
        onRequireFreshAuth={() => setFreshAuthOpen(true)}
      />
      <Button variant="ghost" size="sm" onClick={refresh.reload} disabled={refresh.busy}>
        {L.refreshStatus}
      </Button>
      {confirmed && (
        <p role="status" className="text-sm text-muted-foreground">
          {L.identityConfirmed}
        </p>
      )}
      {freshAuthOpen && (
        <MailboxFreshAuthDialog
          onClose={() => setFreshAuthOpen(false)}
          onConfirmed={() => {
            setConfirmed(true);
            setFreshAuthOpen(false);
          }}
        />
      )}
    </div>
  );
}
