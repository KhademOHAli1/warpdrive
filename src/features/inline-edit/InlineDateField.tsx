"use client";
import type React from "react";
import { DatePicker } from "@/components/ui/DatePicker";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import { useFormatters } from "@/lib/useFormatters";
import { InlineEditFooter } from "./InlineEditFooter";
import { InlineFieldShell } from "./InlineFieldShell";
import { saveErrorMessage } from "./saveError";
import type { InlineSaveFn } from "./useInlineEditField";
import { useInlineEditField } from "./useInlineEditField";

interface InlineDateFieldProps {
  label: string;
  value: string | null;
  onSave: InlineSaveFn<string | null>;
}

// PD-mechanism date field. Verified live (expected close date): picking a day does NOT
// autosave; it lands in the editor's draft (the calendar opens immediately on edit) and the
// dirty-gated Save footer commits it. Only Cancel/Save close the editor.
export function InlineDateField({ label, value, onSave }: InlineDateFieldProps): React.ReactNode {
  const t = useAppTranslations("shell.inline");
  const locale = useLocale();
  const format = useFormatters();
  const f = useInlineEditField(value);
  const dirty = f.draft !== value;

  const editor = f.editing ? (
    <div>
      <DatePicker
        ariaLabel={label}
        value={f.draft}
        onChange={f.setDraft}
        placeholder={t("setDate")}
        defaultOpen
        triggerClassName="flex h-8 w-full items-center rounded border border-field-border bg-card px-2 text-start text-sm"
      />
      <InlineEditFooter
        onCancel={f.cancel}
        onSave={() => f.commit(onSave)}
        saveDisabled={!dirty}
        pending={f.pending}
      />
    </div>
  ) : null;

  return (
    <div className="min-w-0">
      {f.error !== null && !f.editing ? (
        <span className="text-xs text-destructive">{saveErrorMessage(f.error, locale)}</span>
      ) : null}
      <InlineFieldShell
        label={label}
        editing={f.editing}
        onStartEdit={f.start}
        value={
          value !== null
            ? format.dateOnly(value, { year: "numeric", month: "2-digit", day: "2-digit" })
            : null
        }
        emptyPrompt={t("setDate")}
      >
        {editor}
      </InlineFieldShell>
    </div>
  );
}
