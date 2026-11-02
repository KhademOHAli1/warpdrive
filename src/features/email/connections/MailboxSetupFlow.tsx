"use client";

import { ArrowRight, Mail } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { MailboxCredentialsForm } from "./MailboxCredentialsForm";
import { MailboxScopeForm } from "./MailboxScopeForm";
import { type MailboxConnectionMessages, mailboxConnectionMessages } from "./messages";
import type {
  CheckedMailboxConnection,
  MailboxConnectionActions,
  MailboxConnectionView,
} from "./types";
import { MailboxConnectionFeedback, useMailboxConnectionTask } from "./useMailboxConnectionTask";

function headingForStep(
  L: MailboxConnectionMessages,
  step: "provider" | "credentials" | "scope",
  reconnecting: boolean,
) {
  const credentials = reconnecting
    ? { title: L.reconnectTitle, description: L.reconnectDescription }
    : { title: L.credentialsTitle, description: L.credentialsDescription };
  return {
    provider: { title: L.chooseProvider, description: L.chooseDescription },
    credentials,
    scope: { title: L.scopeTitle, description: L.scopeDescription },
  }[step];
}

export function MailboxSetupFlow({
  actions,
  existing,
  gmailAvailable,
  defaultSender,
  onConnected,
  onRequireFreshAuth,
}: {
  actions: MailboxConnectionActions;
  existing?: MailboxConnectionView;
  gmailAvailable: boolean;
  defaultSender: boolean;
  onConnected: () => void;
  onRequireFreshAuth?: () => void;
}) {
  const L = mailboxConnectionMessages(useLocale());
  const [providerChosen, setProviderChosen] = useState(existing !== undefined);
  const [checked, setChecked] = useState<CheckedMailboxConnection | null>(null);
  const [address, setAddress] = useState(existing?.emailAddress ?? "");
  const gmail = useMailboxConnectionTask();
  const heading = headingForStep(
    L,
    checked !== null ? "scope" : providerChosen ? "credentials" : "provider",
    existing !== undefined,
  );
  return (
    <>
      <DialogHeader>
        <DialogTitle>{heading.title}</DialogTitle>
        <DialogDescription>{heading.description}</DialogDescription>
      </DialogHeader>
      {checked !== null ? (
        <MailboxScopeForm
          checked={checked}
          initialSettings={existing}
          actions={actions}
          defaultSender={defaultSender}
          onConnected={onConnected}
          onCheckAgain={() => setChecked(null)}
          onRequireFreshAuth={onRequireFreshAuth}
        />
      ) : providerChosen ? (
        <MailboxCredentialsForm
          actions={actions}
          existing={existing}
          initialAddress={address}
          onChecked={(result) => {
            setAddress(result.mailboxAddress);
            setChecked(result);
          }}
          onRequireFreshAuth={onRequireFreshAuth}
        />
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            <Button
              className="h-auto w-full justify-between whitespace-normal px-4 py-4 text-start"
              variant="outline"
              onClick={() => setProviderChosen(true)}
              aria-label={L.independent}
            >
              <span className="flex min-w-0 items-start gap-3">
                <Mail className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="space-y-1">
                  <span className="block font-medium">{L.independent}</span>
                  <span className="block text-xs font-normal leading-relaxed text-muted-foreground">
                    {L.independentDescription}
                  </span>
                </span>
              </span>
              <ArrowRight
                className="ms-3 size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
                data-rtl-mirror="true"
              />
            </Button>
            {gmailAvailable && actions.connectGmail !== undefined ? (
              <Button
                className="h-auto w-full justify-between whitespace-normal px-4 py-4 text-start"
                variant="outline"
                onClick={() => {
                  const connect = actions.connectGmail;
                  if (connect !== undefined) void gmail.run(connect, () => undefined);
                }}
                disabled={gmail.busy}
                aria-label={L.gmail}
              >
                <span className="space-y-1">
                  <span className="block font-medium">{L.gmail}</span>
                  <span className="block text-xs font-normal leading-relaxed text-muted-foreground">
                    {L.gmailDescription}
                  </span>
                </span>
                <ArrowRight
                  className="ms-3 size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                  data-rtl-mirror="true"
                />
              </Button>
            ) : (
              <p className="px-1 text-xs leading-relaxed text-muted-foreground">
                {L.gmailUnavailable}
              </p>
            )}
          </div>
          <MailboxConnectionFeedback error={gmail.error} onRequireFreshAuth={onRequireFreshAuth} />
          {gmail.busy && (
            <p role="status" className="text-sm text-muted-foreground">
              {L.working}
            </p>
          )}
        </div>
      )}
    </>
  );
}
