"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/Button";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { mailboxConnectionMessages } from "./messages";
import type {
  MailboxConnectionActions,
  MailboxConnectionMutation,
  MailboxConnectionView,
} from "./types";
import { MailboxConnectionFeedback, useMailboxConnectionTask } from "./useMailboxConnectionTask";

export function MailboxManagement({
  mailbox,
  actions,
  onChanged,
  onReconnect,
  onDisconnected,
  reconnectAvailable,
  onRequireFreshAuth,
}: {
  mailbox: MailboxConnectionView;
  actions: MailboxConnectionActions;
  onChanged: () => void;
  onReconnect: () => void;
  onDisconnected: () => void;
  reconnectAvailable: boolean;
  onRequireFreshAuth?: () => void;
}) {
  const L = mailboxConnectionMessages(useLocale());
  const task = useMailboxConnectionTask();
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const capabilityLabels = [
    { enabled: mailbox.capabilities.read, label: L.canRead },
    { enabled: mailbox.capabilities.send, label: L.canSend },
    { enabled: mailbox.capabilities.markRead, label: L.canMarkRead },
    { enabled: mailbox.capabilities.move, label: L.canMove },
    { enabled: mailbox.capabilities.trash, label: L.canTrash },
  ];
  function mutate(action: MailboxConnectionMutation) {
    setNotice(null);
    void task.run(
      (signal) => actions.mutate(mailbox.id, action, signal),
      () => {
        onChanged();
        if (action === "disconnect") onDisconnected();
        else setNotice(L.actionSuccess);
      },
    );
  }
  const active = mailbox.status !== "disconnected";
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h3 className="text-sm font-medium">{L.capabilities}</h3>
        <ul className="space-y-1.5 text-sm text-muted-foreground">
          {capabilityLabels
            .filter((capability) => capability.enabled)
            .map((capability) => (
              <li key={capability.label}>{capability.label}</li>
            ))}
        </ul>
        {!mailbox.capabilities.trash && (
          <p className="text-xs leading-relaxed text-muted-foreground">{L.cannotTrash}</p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {mailbox.status === "connected" && (
          <Button variant="outline" size="sm" disabled={task.busy} onClick={() => mutate("pause")}>
            {L.pause}
          </Button>
        )}
        {mailbox.status === "paused" && (
          <Button variant="outline" size="sm" disabled={task.busy} onClick={() => mutate("resume")}>
            {L.resume}
          </Button>
        )}
        {active && (
          <Button variant="outline" size="sm" disabled={task.busy} onClick={() => mutate("retry")}>
            {L.retry}
          </Button>
        )}
        {!mailbox.isDefault && mailbox.capabilities.send && active && (
          <Button
            variant="outline"
            size="sm"
            disabled={task.busy}
            onClick={() => mutate("setDefault")}
          >
            {L.setDefault}
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          disabled={task.busy || !reconnectAvailable}
          onClick={onReconnect}
        >
          {L.reconnect}
        </Button>
      </div>
      {!reconnectAvailable && <p className="text-sm text-muted-foreground">{L.gmailUnavailable}</p>}
      <MailboxConnectionFeedback error={task.error} onRequireFreshAuth={onRequireFreshAuth} />
      {notice !== null && (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      )}
      {task.busy && (
        <p role="status" className="text-sm text-muted-foreground">
          {L.working}
        </p>
      )}
      {mailbox.remoteRevocationStatus === "pending" && (
        <p className="text-sm text-muted-foreground">{L.disconnectPending}</p>
      )}
      {mailbox.remoteRevocationStatus === "manual" && (
        <p className="text-sm text-muted-foreground">{L.disconnectManual}</p>
      )}
      {mailbox.remoteRevocationStatus === "complete" && (
        <p className="text-sm text-muted-foreground">{L.disconnectComplete}</p>
      )}
      {active && (
        <div className="space-y-3 border-t pt-4">
          <p className="text-xs leading-relaxed text-muted-foreground">{L.disconnectDescription}</p>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive"
            disabled={task.busy}
            onClick={() => setConfirmDisconnect(true)}
          >
            {L.disconnect}
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={confirmDisconnect}
        onOpenChange={setConfirmDisconnect}
        title={L.disconnectTitle}
        description={
          mailbox.provider === "imap_smtp"
            ? `${L.disconnectDescription} ${L.disconnectManual}`
            : L.disconnectDescription
        }
        confirmLabel={L.disconnect}
        cancelLabel={L.cancel}
        destructive
        onConfirm={() => {
          setConfirmDisconnect(false);
          mutate("disconnect");
        }}
      />
    </div>
  );
}
