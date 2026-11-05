"use client";

import { Mail } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useLocale, useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { useFormatters } from "@/lib/useFormatters";
import { gmailMailboxDisplayHealth } from "../syncHealth";
import { MailboxManagement } from "./MailboxManagement";
import { MailboxSetupFlow } from "./MailboxSetupFlow";
import { MailboxSyncProgress } from "./MailboxSyncProgress";
import { mailboxConnectionMessages, mailboxConnectionTranslator } from "./messages";
import type { MailboxConnectionActions, MailboxConnectionView } from "./types";
import { MailboxConnectionFeedback, useMailboxConnectionTask } from "./useMailboxConnectionTask";

function MailboxRowHealth({ mailbox }: { mailbox: MailboxConnectionView }) {
  const { locale, numberingSystem } = useLocalePreferences();
  const L = mailboxConnectionMessages(locale);
  const t = mailboxConnectionTranslator(locale, numberingSystem);
  const format = useFormatters();
  const [now, setNow] = useState<Date | null>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- keep timestamps stable through hydration and use the browser clock for staleness
  useEffect(() => setNow(new Date()), []);
  const health = mailbox.provider === "gmail" ? gmailMailboxDisplayHealth(mailbox, now) : undefined;
  const state = {
    connected: L.connected,
    paused: L.paused,
    disconnected: L.disconnected,
    error: L.error,
    stalled: L.syncStalled,
    "authorization-failed": L.gmailAuthorizationRequired,
  }[health === "stalled" || health === "authorization-failed" ? health : mailbox.status];
  const badgeVariant =
    health === "authorization-failed" || mailbox.status === "error"
      ? "destructive"
      : mailbox.status === "connected" && health !== "stalled"
        ? "success"
        : "secondary";
  const lastChecked = mailbox.lastCheckedAtIso ?? null;
  const dateText = (iso: string) => (now === null ? iso : format.dateTime(iso));
  let healthWarning: string | undefined;
  if (mailbox.errorCode !== undefined && health !== "paused") {
    healthWarning =
      health === "authorization-failed" ? L.gmailAuthorizationHint : L.errors[mailbox.errorCode];
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <Badge data-health={health} variant={badgeVariant}>
          {state}
        </Badge>
        {mailbox.lastSyncAtIso === null ? (
          <span>{L.neverSynced}</span>
        ) : (
          <time dateTime={mailbox.lastSyncAtIso}>
            {t("lastSynced", { date: dateText(mailbox.lastSyncAtIso) })}
          </time>
        )}
        {mailbox.provider === "gmail" &&
          (lastChecked === null ? (
            <span>{L.neverChecked}</span>
          ) : (
            <time dateTime={lastChecked}>{t("lastChecked", { date: dateText(lastChecked) })}</time>
          ))}
      </div>
      <MailboxSyncProgress progress={mailbox.syncProgress} />
      {healthWarning !== undefined && (
        <p className="text-xs leading-relaxed text-destructive">{healthWarning}</p>
      )}
    </>
  );
}

export function MailboxConnectionRow({
  mailbox,
  actions,
  gmailAvailable,
  onChanged,
  onNotice,
  onRequireFreshAuth,
}: {
  mailbox: MailboxConnectionView;
  actions: MailboxConnectionActions;
  gmailAvailable: boolean;
  onChanged: () => void;
  onNotice: (notice: string) => void;
  onRequireFreshAuth?: () => void;
}) {
  const id = useId();
  const L = mailboxConnectionMessages(useLocale());
  const [open, setOpen] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const gmail = useMailboxConnectionTask();
  function close(next: boolean) {
    setOpen(next);
    if (!next) setReconnecting(false);
  }
  return (
    <li className="px-5 py-4">
      <Dialog open={open} onOpenChange={close}>
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-4">
          <div className="hidden size-9 shrink-0 items-center justify-center rounded-lg border bg-muted/30 text-muted-foreground sm:flex">
            <Mail className="size-4" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <p id={id} className="min-w-0 break-all text-sm font-medium">
                <bdi dir="ltr">{mailbox.emailAddress}</bdi>
              </p>
              {mailbox.isDefault && <Badge variant="outline">{L.defaultSender}</Badge>}
            </div>
            <p className="text-xs text-muted-foreground">
              {mailbox.provider === "gmail" ? L.providerGmail : L.providerImap}
            </p>
            <MailboxRowHealth mailbox={mailbox} />
          </div>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" aria-describedby={id}>
              {L.manage}
            </Button>
          </DialogTrigger>
        </div>
        <DialogContent
          className={
            reconnecting
              ? "max-h-[90dvh] overflow-y-auto sm:max-w-2xl"
              : "max-h-[90dvh] overflow-y-auto sm:max-w-md"
          }
        >
          {!reconnecting && (
            <DialogHeader>
              <DialogTitle>{L.manage}</DialogTitle>
              <DialogDescription>{L.manageDescription}</DialogDescription>
            </DialogHeader>
          )}
          {open &&
            (reconnecting ? (
              <MailboxSetupFlow
                actions={actions}
                existing={mailbox}
                gmailAvailable={gmailAvailable}
                defaultSender={mailbox.isDefault}
                onRequireFreshAuth={onRequireFreshAuth}
                onConnected={() => {
                  close(false);
                  onChanged();
                  onNotice(L.saveSuccess);
                }}
                onReviewSavedSettings={() => {
                  close(false);
                  onChanged();
                  onNotice(L.savedSettingsReloaded);
                }}
              />
            ) : (
              <MailboxManagement
                mailbox={mailbox}
                actions={actions}
                onChanged={onChanged}
                onReconnect={() => {
                  const connect = actions.connectGmail;
                  if (mailbox.provider === "gmail") {
                    if (connect !== undefined) void gmail.run(connect, () => undefined);
                  } else setReconnecting(true);
                }}
                onDisconnected={() => {
                  close(false);
                  onNotice(L.disconnectSuccess);
                }}
                reconnectAvailable={
                  mailbox.provider !== "gmail" ||
                  (gmailAvailable && actions.connectGmail !== undefined)
                }
                onRequireFreshAuth={onRequireFreshAuth}
              />
            ))}
          <MailboxConnectionFeedback error={gmail.error} onRequireFreshAuth={onRequireFreshAuth} />
          <DialogFooter className="border-t pt-4">
            <DialogClose asChild>
              <Button variant="ghost">{L.close}</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}
