"use client";
import type React from "react";
import { useRef } from "react";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import type { Locale } from "@/features/i18n/registry";
import { InlineEditFooter } from "@/features/inline-edit/InlineEditFooter";
import { InlineFieldShell } from "@/features/inline-edit/InlineFieldShell";
import type { InlineSaveFn } from "@/features/inline-edit/useInlineEditField";
import { dealEditErrorMessage as saveErrorMessage } from "./dealEditErrorMessage";
import { type DealInlineSaveFn, useDealEditSnapshot } from "./useDealEditSnapshot";

interface DealInlineTextFieldProps {
  label: string;
  writeVersion: string;
  value: string;
  onSave: (
    value: string,
    expectedWriteVersion: string,
    draftLocale: Locale,
  ) => ReturnType<InlineSaveFn<string>>;
  placeholder?: string;
  formatError?: (error: string) => string | undefined;
}

// PD-mechanism text field (see docs/superpowers/specs/2026-07-08-pd-inline-edit-mechanism.md):
// plain selectable value + hover pencil; the pencil (or the empty-field prompt) opens a 32px
// input with the Cancel/Save footer. Save is dirty-gated; Enter commits when dirty; Escape,
// blur, and outside clicks do nothing (PD has no such dismissal).
export function DealInlineTextField({
  label,
  writeVersion,
  value,
  onSave,
  placeholder,
  formatError,
}: DealInlineTextFieldProps): React.ReactNode {
  const t = useAppTranslations("shell.inline");
  const locale = useLocale();
  const f = useDealEditSnapshot(value, writeVersion);
  const draftLocale = useRef<Locale | null>(null);
  const dirty = f.draft !== value;
  const start = (): void => {
    if (f.start() && (f.error === null || draftLocale.current === null))
      draftLocale.current = locale;
  };
  const cancel = (): void => {
    if (f.cancel()) draftLocale.current = null;
  };
  const save: DealInlineSaveFn<string> = (draft, version) =>
    onSave(draft, version, draftLocale.current ?? locale);

  const editor = f.editing ? (
    <div>
      <input
        aria-label={label}
        // biome-ignore lint/a11y/noAutofocus: inline edit focuses immediately on activation
        autoFocus
        value={f.draft}
        disabled={f.pending}
        onChange={(e) => f.setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && dirty) f.commit(save);
        }}
        className="h-8 w-full rounded border border-field-border bg-card px-2 text-sm"
      />
      <InlineEditFooter
        onCancel={cancel}
        onSave={() => f.commit(save)}
        saveDisabled={!dirty}
        pending={f.pending}
      />
    </div>
  ) : null;

  return (
    <div className="min-w-0">
      {f.error !== null && !f.editing ? (
        <span className="text-xs text-destructive">
          {formatError?.(f.error) ?? saveErrorMessage(f.error, locale)}
        </span>
      ) : null}
      <InlineFieldShell
        label={label}
        editing={f.editing}
        onStartEdit={start}
        value={value === "" ? null : value}
        emptyPrompt={placeholder ?? t("add")}
      >
        {editor}
      </InlineFieldShell>
    </div>
  );
}
