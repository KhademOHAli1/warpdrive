"use client";
import { Copy, Settings } from "lucide-react";
import type React from "react";
import { ToggleField } from "@/components/ui/ToggleField";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";

interface Props {
  done: boolean;
  onDone: (v: boolean) => void;
  pending: boolean;
  onDuplicate: () => void;
  onCancel: () => void;
  onSave: () => void;
}

// Activity-composer action bar (Pipedrive parity). PD layout: the settings gear sits alone on the
// left; Mark-as-done, Cancel, Save, and the Duplicate icon are end-grouped, in that order (WD was
// missing Cancel and put Mark-as-done on the left / Duplicate before Save). Kept as its own
// component so ActivityComposerInline stays within the file-size cap.
export function ComposerFooter({
  done,
  onDone,
  pending,
  onDuplicate,
  onCancel,
  onSave,
}: Props): React.ReactNode {
  const translateSales = useAppTranslations("sales");

  return (
    <div className="flex items-center justify-between border-t pt-3">
      <a
        href="/settings/company/activities"
        aria-label={translateSales("activity_settings_34125")}
        className="text-muted-foreground hover:text-foreground"
      >
        <Settings className="h-4 w-4" />
      </a>
      <div className="flex items-center gap-3">
        <ToggleField
          label={translateSales("mark_as_done_62aa4")}
          checked={done}
          onCheckedChange={onDone}
          className="gap-1.5 text-sm text-foreground"
        />
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border px-4 py-1.5 font-medium transition-[background-color,scale] duration-150 ease-out hover:bg-accent active:scale-[0.96]"
        >
          {translateSales("cancel_19766")}
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={pending}
          className="rounded-md bg-action px-4 py-1.5 font-medium text-action-foreground transition-[opacity,scale] duration-150 ease-out hover:opacity-90 active:not-disabled:scale-[0.96] disabled:opacity-50"
        >
          {pending ? translateSales("saving_dc85a") : translateSales("save_1509f")}
        </button>
        <button
          type="button"
          aria-label={translateSales("duplicate_02cda")}
          onClick={onDuplicate}
          className="grid size-9 place-items-center rounded-md border text-muted-foreground transition-transform hover:text-foreground active:scale-[0.96]"
        >
          <Copy className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
