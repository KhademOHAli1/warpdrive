"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Input } from "@/components/ui/Input";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { useFormatters } from "@/lib/useFormatters";
import { mailboxFolderLabel } from "./folderLabels";
import { MailboxSentCopyOptions } from "./MailboxSentCopyOptions";
import { mailboxConnectionMessages } from "./messages";
import { buildMailboxScope, DEFAULT_MAIL_HISTORY_DAYS } from "./model";
import type {
  CheckedMailboxConnection,
  MailboxConnectionActions,
  MailboxConnectionView,
  MailboxSentCopyMode,
} from "./types";
import { MailboxConnectionFeedback, useMailboxConnectionTask } from "./useMailboxConnectionTask";

export function MailboxScopeForm({
  checked,
  initialSettings,
  actions,
  defaultSender,
  onConnected,
  onCheckAgain,
  onRequireFreshAuth,
}: {
  checked: CheckedMailboxConnection;
  initialSettings?: MailboxConnectionView;
  actions: MailboxConnectionActions;
  defaultSender: boolean;
  onConnected: () => void;
  onCheckAgain: () => void;
  onRequireFreshAuth?: () => void;
}) {
  const id = useId();
  const L = mailboxConnectionMessages(useLocale());
  const format = useFormatters();
  const [folders, setFolders] = useState(() =>
    initialSettings?.folderPaths !== undefined
      ? initialSettings.folderPaths.filter((path) =>
          checked.folders.some((folder) => folder.path === path),
        )
      : checked.folders
          .filter((folder) => folder.role === "inbox" || folder.role === "sent")
          .map((folder) => folder.path),
  );
  const [days, setDays] = useState(() =>
    format.number(initialSettings?.historyDays ?? DEFAULT_MAIL_HISTORY_DAYS, {
      useGrouping: false,
    }),
  );
  const [sentCopyMode, setSentCopyMode] = useState<MailboxSentCopyMode>(
    initialSettings?.sentCopyMode ?? "crm_only",
  );
  const [sentFolderPath, setSentFolderPath] = useState(
    initialSettings?.sentFolderPath ??
      checked.folders.find((folder) => folder.role === "sent" && folder.readOnly !== true)?.path ??
      "",
  );
  const foldersChanged =
    initialSettings?.folderPaths?.some(
      (path) => !checked.folders.some((folder) => folder.path === path),
    ) === true;
  const [isDefault, setIsDefault] = useState(defaultSender && checked.capabilities.send);
  const [validation, setValidation] = useState<string | null>(null);
  const task = useMailboxConnectionTask();
  return (
    <form
      className="space-y-5"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const input = buildMailboxScope({
          checked,
          folders,
          days,
          isDefault,
          sentCopyMode,
          sentFolderPath,
        });
        if (!input.ok) {
          setValidation(L[input.error]);
          return;
        }
        setValidation(null);
        void task.run((signal) => actions.save(input.value, signal), onConnected);
      }}
    >
      <div className="rounded-lg border bg-muted/20 px-4 py-3 text-sm">
        <p className="text-xs text-muted-foreground">{L.scopeAddress}</p>
        <p className="mt-1 break-all font-medium">
          <bdi dir="ltr">{checked.mailboxAddress}</bdi>
        </p>
      </div>
      {foldersChanged && (
        <p role="status" className="text-sm text-muted-foreground">
          {L.foldersChanged}
        </p>
      )}
      <fieldset className="space-y-3" disabled={task.busy}>
        <legend className="mb-3 text-sm font-medium">{L.folders}</legend>
        {checked.folders.length === 0 && (
          <p className="text-sm text-muted-foreground">{L.noFolders}</p>
        )}
        {checked.folders.map((folder, index) => {
          const label = mailboxFolderLabel(folder, L);
          return (
            <label
              key={folder.path}
              htmlFor={`${id}-folder-${index}`}
              className="flex cursor-pointer items-start gap-3 rounded-md border px-3 py-3 text-sm"
            >
              <Checkbox
                id={`${id}-folder-${index}`}
                checked={folders.includes(folder.path)}
                label={label}
                className="mt-0.5"
                onCheckedChange={(selected) =>
                  setFolders((current) =>
                    selected
                      ? [...current, folder.path]
                      : current.filter((path) => path !== folder.path),
                  )
                }
              />
              <span className="min-w-0 flex-1 break-words">
                <bdi>{label}</bdi>
              </span>
              {folder.readOnly === null && (
                <span className="text-xs text-muted-foreground">{L.accessUnknown}</span>
              )}
              {folder.readOnly === true && (
                <span className="text-xs text-muted-foreground">{L.readOnly}</span>
              )}
            </label>
          );
        })}
      </fieldset>
      <div className="space-y-1.5 text-sm">
        <label htmlFor={`${id}-history`} className="block font-medium">
          {L.historyDays}
        </label>
        <Input
          id={`${id}-history`}
          value={days}
          dir="ltr"
          inputMode="numeric"
          className="max-w-32"
          onChange={(event) => setDays(event.target.value)}
          disabled={task.busy}
          aria-describedby={`${id}-history-help`}
        />
        <span
          id={`${id}-history-help`}
          className="block text-xs leading-relaxed text-muted-foreground"
        >
          {L.historyHelp}
        </span>
      </div>
      {checked.capabilities.send && (
        <label htmlFor={`${id}-default`} className="flex cursor-pointer items-start gap-3 text-sm">
          <Checkbox
            id={`${id}-default`}
            checked={isDefault}
            onCheckedChange={setIsDefault}
            label={L.isDefault}
            disabled={task.busy}
            className="mt-0.5"
          />
          <span className="space-y-1">
            <span className="block font-medium">{L.isDefault}</span>
            <span className="block text-xs leading-relaxed text-muted-foreground">
              {L.defaultHelp}
            </span>
          </span>
        </label>
      )}
      {checked.capabilities.send && (
        <MailboxSentCopyOptions
          mode={sentCopyMode}
          onModeChange={setSentCopyMode}
          folderPath={sentFolderPath}
          onFolderChange={setSentFolderPath}
          folders={checked.folders}
          disabled={task.busy}
        />
      )}
      {validation !== null && (
        <p role="alert" className="text-sm text-destructive">
          {validation}
        </p>
      )}
      <MailboxConnectionFeedback error={task.error} onRequireFreshAuth={onRequireFreshAuth} />
      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <Button variant="ghost" onClick={onCheckAgain} disabled={task.busy}>
          {task.error === "stale_check" ? L.retryCheck : L.back}
        </Button>
        <Button type="submit" disabled={task.busy || checked.folders.length === 0}>
          {task.busy ? L.connecting : L.connect}
        </Button>
      </div>
      {task.busy && (
        <p role="status" className="sr-only">
          {L.connecting}
        </p>
      )}
    </form>
  );
}
