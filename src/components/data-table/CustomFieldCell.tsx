"use client";
import type React from "react";
import { Tip } from "@/components/ui/tooltip";
import { useCustomFieldRefLabels } from "@/features/custom-fields/refLabelsContext";
import { formatCustomFieldDisplay, isCustomFieldValueEmpty } from "@/features/custom-fields/render";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import type { CustomFieldDef } from "@/types/customFields";

export function customFieldCellClass(def: CustomFieldDef): string {
  const numeric = def.type === "numeric" || def.type === "monetary";
  return numeric
    ? "px-3 py-2 tabular-nums text-end text-muted-foreground"
    : "px-3 py-2 text-muted-foreground";
}

export function CustomFieldCell({
  def,
  value,
  currency,
}: {
  def: CustomFieldDef;
  value: unknown;
  currency: string;
}): React.ReactNode {
  const preferences = useLocalePreferences();
  const refLabels = useCustomFieldRefLabels();
  if (isCustomFieldValueEmpty(value)) return null;
  const text = formatCustomFieldDisplay(def, value, currency, refLabels, preferences);
  return (
    <Tip label={text}>
      <bdi
        dir={def.type === "phone" || def.type === "time" ? "ltr" : "auto"}
        className="block max-w-[28rem] truncate"
      >
        {text}
      </bdi>
    </Tip>
  );
}
