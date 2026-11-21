"use client";
import type React from "react";
import { useId } from "react";
import { Checkbox } from "@/components/ui/Checkbox";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";

interface CreateFilterModalNameRowProps {
  name: string;
  nameLabel?: string;
  onNameChange: (name: string) => void;
  isShared: boolean;
  onSharedChange: (isShared: boolean) => void;
}

// Name field + shared toggle, the row under the conditions in the filter dialog.
export function CreateFilterModalNameRow({
  name,
  nameLabel,
  onNameChange,
  isShared,
  onSharedChange,
}: CreateFilterModalNameRowProps): React.ReactNode {
  const translateSales = useAppTranslations("sales");
  const label = nameLabel ?? translateSales("filter_name_95706");

  const nameId = useId();
  return (
    <div className="grid grid-cols-2 gap-4 pt-4">
      <label className="block text-sm">
        <span className="mb-1 block font-medium" id={nameId}>
          {label}
        </span>
        <input
          aria-labelledby={nameId}
          aria-label={label}
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder={translateSales("named_from_your_conditions_a1144")}
          className="w-full rounded-md border px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring/50"
        />
      </label>
      <div className="flex items-center gap-2 self-end pb-1.5 text-sm">
        <Checkbox
          label={translateSales("shared_e3c4b")}
          checked={isShared}
          onCheckedChange={onSharedChange}
        />
        <span>{translateSales("shared_with_everyone_f1cf1")}</span>
      </div>
    </div>
  );
}
