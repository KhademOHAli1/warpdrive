"use client";
import type React from "react";
import { useRef, useState } from "react";
import { useLocale } from "@/features/i18n/LocaleProvider";
import type { Locale } from "@/features/i18n/registry";
import { InlineEditFooter } from "@/features/inline-edit/InlineEditFooter";
import { InlineFieldShell } from "@/features/inline-edit/InlineFieldShell";
import { saveErrorMessage } from "@/features/inline-edit/saveError";
import { FieldRow } from "./FieldRow";

interface SidebarFieldRowProps {
  label: string;
  value: React.ReactNode;
  readOnly?: boolean;
  // Render-prop editor. Receives a controlled value + setter the row owns.
  renderEditor?: (args: { draft: string; setDraft: (v: string) => void }) => React.ReactNode;
  initialDraft?: string;
  // Optional so readOnly rows (which never render Save) don't need to pass a handler. On failure it
  // may carry the AppError id so the row can show a specific message (e.g. permission denied).
  onSave?: (draft: string, draftLocale: Locale) => Promise<{ ok: boolean; errorId?: string }>;
  // Marks a value-less row so the section's hide-empty-fields funnel can hide it (mirrors
  // FieldRow.empty). Defaults false so a bare SidebarFieldRow always shows.
  empty?: boolean;
}

// Pipedrive-mechanism sidebar field row (see
// docs/superpowers/specs/2026-07-08-pd-inline-edit-mechanism.md): the value is plain
// selectable text; hovering reveals a end-edge pencil which is the ONLY way into edit
// mode; the editor swaps in place with a end-aligned, dirty-gated Cancel/Save footer.
// Escape/blur/outside clicks never dismiss (PD has no such gesture). Save is held open
// on failure so the draft isn't lost.
export function SidebarFieldRow({
  label,
  value,
  readOnly = false,
  renderEditor,
  initialDraft = "",
  onSave,
  empty = false,
}: SidebarFieldRowProps): React.ReactNode {
  const locale = useLocale();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialDraft);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draftLocale = useRef(locale);
  const start = (): void => {
    draftLocale.current = locale;
    setDraft(initialDraft);
    setError(null);
    setEditing(true);
  };

  const cancel = (): void => {
    setError(null);
    setEditing(false);
  };

  const save = (): void => {
    if (onSave === undefined) {
      setEditing(false);
      return;
    }
    setPending(true);
    setError(null);
    onSave(draft, draftLocale.current)
      .then((result) => {
        setPending(false);
        if (result.ok) {
          setEditing(false);
        } else {
          setError(saveErrorMessage(result.errorId, locale));
        }
      })
      .catch(() => {
        setPending(false);
        setError(saveErrorMessage(undefined, locale));
      });
  };

  if (readOnly) {
    return (
      <FieldRow label={label} empty={empty}>
        <span className="block min-w-0 truncate text-start text-sm">{value}</span>
      </FieldRow>
    );
  }

  return (
    <FieldRow label={label} empty={empty}>
      <InlineFieldShell label={label} editing={editing} onStartEdit={start} value={value}>
        <div className="flex flex-col gap-1.5">
          {renderEditor?.({ draft, setDraft })}
          {error !== null ? (
            <span role="alert" className="text-destructive text-xs">
              {error}
            </span>
          ) : null}
          <InlineEditFooter
            onCancel={cancel}
            onSave={save}
            saveDisabled={draft === initialDraft}
            pending={pending}
          />
        </div>
      </InlineFieldShell>
    </FieldRow>
  );
}
