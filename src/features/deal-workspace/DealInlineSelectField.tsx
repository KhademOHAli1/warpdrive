"use client";
import type React from "react";
import { Select, type SelectOption } from "@/components/ui/Select";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import { InlineEditFooter } from "@/features/inline-edit/InlineEditFooter";
import { InlineFieldShell } from "@/features/inline-edit/InlineFieldShell";
import { dealEditErrorMessage as saveErrorMessage } from "./dealEditErrorMessage";
import { type DealInlineSaveFn, useDealEditSnapshot } from "./useDealEditSnapshot";

interface DealInlineSelectFieldProps {
  label: string;
  writeVersion: string;
  value: string;
  options: SelectOption[];
  onSave: DealInlineSaveFn<string>;
  placeholder?: string;
  // Custom view-mode rendering for the current value (e.g. an OwnerBadge with avatar), in place of
  // the plain option label. Falls back to the option's label when omitted.
  renderValue?: (value: string) => React.ReactNode;
}

// Keep the shared select interaction: selecting an option does NOT autosave
// on pick; the option lands in the editor's draft and the dirty-gated Save footer commits it,
// identical to text fields. Only Cancel/Save close the editor.
export function DealInlineSelectField({
  label,
  writeVersion,
  value,
  options,
  onSave,
  placeholder,
  renderValue,
}: DealInlineSelectFieldProps): React.ReactNode {
  const t = useAppTranslations("shell.inline");
  const locale = useLocale();
  const f = useDealEditSnapshot(value, writeVersion);
  const dirty = f.draft !== value;
  const selectedLabel = options.find((o) => o.value === value)?.label ?? "";

  const editor = f.editing ? (
    <div>
      <Select ariaLabel={label} value={f.draft} options={options} onChange={f.setDraft} />
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
          selectedLabel === ""
            ? null
            : renderValue !== undefined
              ? renderValue(value)
              : selectedLabel
        }
        emptyPrompt={placeholder ?? t("add")}
      >
        {editor}
      </InlineFieldShell>
    </div>
  );
}
