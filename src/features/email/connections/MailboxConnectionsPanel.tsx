"use client";

import { Mail, Plus } from "lucide-react";
import { useState } from "react";
import { SettingsCard, SettingsCardBody } from "@/app/(app)/settings/SettingsSurface";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { MailboxConnectionRow } from "./MailboxConnectionRow";
import { MailboxSetupFlow } from "./MailboxSetupFlow";
import { mailboxConnectionMessages } from "./messages";
import type { MailboxConnectionActions, MailboxConnectionView } from "./types";

export function MailboxConnectionsPanel({
  mailboxes,
  actions,
  onChanged,
  gmailAvailable = false,
  onRequireFreshAuth,
}: {
  mailboxes: MailboxConnectionView[];
  actions: MailboxConnectionActions;
  onChanged?: () => void;
  gmailAvailable?: boolean;
  onRequireFreshAuth?: () => void;
}) {
  const L = mailboxConnectionMessages(useLocale());
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const refresh = () => onChanged?.();
  return (
    <div className="space-y-4">
      <SettingsCard>
        <Dialog open={open} onOpenChange={setOpen}>
          <div className="flex flex-col items-start gap-3 border-b px-5 py-4 sm:flex-row sm:justify-between sm:gap-4">
            <div className="min-w-0 space-y-1">
              <h2 className="text-sm font-semibold">{L.title}</h2>
              <p className="text-sm leading-relaxed text-muted-foreground">{L.description}</p>
            </div>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="shrink-0">
                <Plus className="size-4" aria-hidden="true" />
                {L.add}
              </Button>
            </DialogTrigger>
          </div>
          <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
            {open && (
              <MailboxSetupFlow
                actions={actions}
                gmailAvailable={gmailAvailable}
                defaultSender={!mailboxes.some((mailbox) => mailbox.isDefault)}
                onRequireFreshAuth={onRequireFreshAuth}
                onConnected={() => {
                  setOpen(false);
                  setNotice(L.saveSuccess);
                  refresh();
                }}
              />
            )}
            <DialogFooter className="border-t pt-4">
              <DialogClose asChild>
                <Button variant="ghost">{L.cancel}</Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        {mailboxes.length === 0 ? (
          <SettingsCardBody>
            <div className="flex items-start gap-3 py-2">
              <Mail className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="space-y-1">
                <p className="text-sm font-medium">{L.empty}</p>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {L.emptyDescription}
                </p>
              </div>
            </div>
          </SettingsCardBody>
        ) : (
          <ul className="divide-y">
            {mailboxes.map((mailbox) => (
              <MailboxConnectionRow
                key={mailbox.id}
                mailbox={mailbox}
                actions={actions}
                gmailAvailable={gmailAvailable}
                onChanged={refresh}
                onNotice={setNotice}
                onRequireFreshAuth={onRequireFreshAuth}
              />
            ))}
          </ul>
        )}
      </SettingsCard>
      {notice !== null && (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      )}
    </div>
  );
}
