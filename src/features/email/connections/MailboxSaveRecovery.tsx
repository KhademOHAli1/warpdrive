"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { useFormatters } from "@/lib/useFormatters";
import { mailboxConnectionMessages, mailboxConnectionTranslator } from "./messages";
import type { MailboxConnectionActions, MailboxConnectionView } from "./types";
import { MailboxConnectionFeedback, useMailboxConnectionTask } from "./useMailboxConnectionTask";

export function MailboxSaveRecovery({
  actions,
  mailboxAddress,
  accountId,
  onRequireFreshAuth,
  onReviewSavedSettings,
}: {
  actions: MailboxConnectionActions;
  mailboxAddress: string;
  accountId?: string;
  onRequireFreshAuth?: () => void;
  onReviewSavedSettings?: () => void;
}) {
  const preferences = useLocalePreferences();
  const L = mailboxConnectionMessages(preferences.locale);
  const t = mailboxConnectionTranslator(preferences.locale, preferences.numberingSystem);
  const format = useFormatters();
  const task = useMailboxConnectionTask();
  const [loaded, setLoaded] = useState(false);
  const [mailbox, setMailbox] = useState<MailboxConnectionView | null>(null);
  const list = actions.list;
  return (
    <section className="space-y-3 rounded-lg border p-4" aria-label={L.reloadSavedSettings}>
      <p role="status" className="text-sm leading-relaxed">
        {L.saveUncertain}
      </p>
      {list !== undefined && (
        <Button
          type="button"
          variant="outline"
          disabled={task.busy}
          onClick={() => {
            setLoaded(false);
            setMailbox(null);
            void task.run(list, (mailboxes) => {
              const matches = mailboxes.filter(
                (current) =>
                  current.provider === "imap_smtp" &&
                  (accountId === undefined
                    ? current.emailAddress.toLowerCase() === mailboxAddress.toLowerCase()
                    : current.id === accountId),
              );
              // This is only a view of currently owned settings, never a save receipt.
              setMailbox(matches.length === 1 ? (matches[0] ?? null) : null);
              setLoaded(true);
            });
          }}
        >
          {task.busy ? L.refreshing : L.reloadSavedSettings}
        </Button>
      )}
      <MailboxConnectionFeedback error={task.error} onRequireFreshAuth={onRequireFreshAuth} />
      {loaded &&
        (mailbox === null ? (
          <p role="status" className="text-sm leading-relaxed">
            {L.savedMailboxNotFound}
          </p>
        ) : (
          <div className="space-y-3 text-sm">
            <p className="leading-relaxed">{L.savedSettingsUnconfirmed}</p>
            <dl className="space-y-2">
              <div>
                <dt className="text-muted-foreground">{L.email}</dt>
                <dd>
                  <bdi dir="ltr">{mailbox.emailAddress}</bdi>
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{L.currentMailboxState}</dt>
                <dd>
                  {
                    {
                      connected: L.connected,
                      paused: L.paused,
                      error: L.error,
                      disconnected: L.disconnected,
                    }[mailbox.status]
                  }
                </dd>
              </div>
              {mailbox.historyDays !== undefined && (
                <div>
                  <dt className="text-muted-foreground">{L.historyDays}</dt>
                  <dd>{format.number(mailbox.historyDays)}</dd>
                </div>
              )}
              {mailbox.folderPaths !== undefined && (
                <div>
                  <dt className="text-muted-foreground">{L.folders}</dt>
                  <dd>
                    {mailbox.folderPaths.map((path) => (
                      <bdi key={path} className="me-2">
                        {path}
                      </bdi>
                    ))}
                  </dd>
                </div>
              )}
            </dl>
            <p>
              {mailbox.lastSyncAtIso === null
                ? L.neverSynced
                : t("lastSynced", { date: format.dateTime(mailbox.lastSyncAtIso) })}
            </p>
            {onReviewSavedSettings !== undefined && (
              <Button type="button" variant="outline" onClick={onReviewSavedSettings}>
                {L.reviewSavedSettings}
              </Button>
            )}
          </div>
        ))}
    </section>
  );
}
