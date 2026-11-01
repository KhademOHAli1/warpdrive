"use client";

import { useId } from "react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/RadioGroup";
import { Select } from "@/components/ui/Select";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { mailboxFolderLabel } from "./folderLabels";
import { mailboxConnectionMessages } from "./messages";
import type { MailboxFolder, MailboxSentCopyMode } from "./types";

export function MailboxSentCopyOptions({
  mode,
  onModeChange,
  folderPath,
  onFolderChange,
  folders,
  disabled,
}: {
  mode: MailboxSentCopyMode;
  onModeChange: (mode: MailboxSentCopyMode) => void;
  folderPath: string;
  onFolderChange: (path: string) => void;
  folders: MailboxFolder[];
  disabled: boolean;
}) {
  const id = useId();
  const L = mailboxConnectionMessages(useLocale());
  const eligible = folders.filter((folder) => folder.readOnly !== true);
  const selected = eligible.find((folder) => folder.path === folderPath);
  return (
    <fieldset className="space-y-3 border-t pt-4" disabled={disabled}>
      <legend className="pe-2 text-sm font-medium">{L.sentCopyTitle}</legend>
      <p className="text-xs leading-relaxed text-muted-foreground">{L.sentCopyHelp}</p>
      <RadioGroup
        value={mode}
        onValueChange={(value) => {
          if (value === "crm_only" || value === "append") onModeChange(value);
        }}
        disabled={disabled}
        aria-label={L.sentCopyTitle}
      >
        {[
          { value: "crm_only", label: L.sentCopyCrmOnly },
          { value: "append", label: L.sentCopyAppend },
        ].map((option) => (
          <label
            key={option.value}
            htmlFor={`${id}-${option.value}`}
            className="flex cursor-pointer items-start gap-3 text-sm"
          >
            <RadioGroupItem
              id={`${id}-${option.value}`}
              value={option.value}
              aria-label={option.label}
              className="mt-0.5 shrink-0"
            />
            <span>{option.label}</span>
          </label>
        ))}
      </RadioGroup>
      {mode === "append" && (
        <div className="space-y-2">
          <p className="text-sm font-medium">{L.sentFolder}</p>
          <Select
            ariaLabel={L.sentFolder}
            value={folderPath}
            onChange={onFolderChange}
            disabled={disabled || eligible.length === 0}
            options={eligible.map((folder) => ({
              value: folder.path,
              label: mailboxFolderLabel(folder, L),
            }))}
            placeholder={L.chooseSentFolder}
          />
          {eligible.length === 0 && (
            <p className="text-xs leading-relaxed text-muted-foreground">{L.noSentFolders}</p>
          )}
          {selected?.readOnly === null && (
            <p className="text-xs leading-relaxed text-muted-foreground">{L.sentAccessUnknown}</p>
          )}
        </div>
      )}
    </fieldset>
  );
}
