"use client";
import { Button } from "@/components/ui/Button";
import { useAppTranslations, useLocale, useMessages } from "@/features/i18n/LocaleProvider";
import { useFormatters } from "@/lib/useFormatters";
import { type MappingPickerModel, mappingSourceView } from "./mappingView";

export function MappingChip({
  model,
  onInspect,
  onChange,
  onRemove,
}: {
  model: MappingPickerModel;
  onInspect: () => void;
  onChange: () => void;
  onRemove: () => void;
}) {
  const t = useAppTranslations("workflows");
  const messages = useMessages().workflows;
  const locale = useLocale();
  const format = useFormatters();
  const source = mappingSourceView(
    model,
    model.selected.source,
    locale,
    messages.fields,
    format.number,
  );
  const canEdit = model.editable && model.state !== "denied";
  return (
    <fieldset
      aria-label={t("mappingChipLabel")}
      className="space-y-2 rounded-md border bg-muted/30 p-3"
    >
      <bdi className="block text-sm font-medium" dir="auto">
        {source === undefined
          ? t("unavailableValue")
          : `${source.field} · ${source.name} ${source.number}`}
      </bdi>
      {source !== undefined && (
        <span className="text-xs text-muted-foreground">{messages.mappingTypes[source.kind]}</span>
      )}
      {model.selected.source?.needsConfiguration === true && (
        <p className="text-xs">{t("mappingNeedsConfiguration")}</p>
      )}
      <div className="flex flex-wrap gap-1">
        <Button variant="ghost" size="sm" onClick={onInspect}>
          {t("mappingInspect")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={!canEdit}
          onClick={() => {
            if (canEdit) onChange();
          }}
        >
          {t("mappingChange")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={!canEdit}
          onClick={() => {
            if (canEdit) onRemove();
          }}
        >
          {t("mappingRemove")}
        </Button>
      </div>
    </fieldset>
  );
}
