"use client";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/Input";
import { useAppTranslations, useLocale, useMessages } from "@/features/i18n/LocaleProvider";
import { useFormatters } from "@/lib/useFormatters";
import type { ReferenceBinding } from "../schemas";
import {
  type MappingChoice,
  type MappingPickerModel,
  mappingReferenceKey,
  mappingSourceView,
} from "./mappingView";

interface Props {
  open: boolean;
  model: MappingPickerModel;
  onChoose: (reference: ReferenceBinding) => void;
  onClose: () => void;
  onCloseAutoFocus?: (event: Event) => void;
}
function SourceChoice({
  choice,
  model,
  onChoose,
}: {
  choice: MappingChoice;
  model: MappingPickerModel;
  onChoose: Props["onChoose"];
}) {
  const t = useAppTranslations("workflows");
  const messages = useMessages().workflows;
  const locale = useLocale();
  const format = useFormatters();
  const source = mappingSourceView(model, choice.output, locale, messages.fields, format.number);
  if (source === undefined) return null;
  const canChoose = model.editable && model.state !== "denied";
  return (
    <Button
      variant="outline"
      aria-disabled={!canChoose}
      className="h-auto w-full justify-start whitespace-normal p-3 text-start aria-disabled:opacity-60"
      onClick={() => {
        if (canChoose) onChoose(choice.binding);
      }}
    >
      <span className="block space-y-1">
        <bdi className="block" dir="auto">
          {source.field} · {source.name} {source.number}
        </bdi>
        <span className="block text-xs text-muted-foreground">
          {messages.mappingTypes[source.kind]}
        </span>
        {choice.output.needsConfiguration === true && (
          <span className="block text-xs">{t("mappingNeedsConfiguration")}</span>
        )}
        {choice.compatibility === "runtime-value-check" && (
          <span className="block text-xs">{t("mappingPossibleNull")}</span>
        )}
        {!model.editable && <span className="block text-xs">{t("mappingReadonly")}</span>}
      </span>
    </Button>
  );
}
function sourceMatches(
  choice: MappingChoice,
  model: MappingPickerModel,
  query: string,
  locale: ReturnType<typeof useLocale>,
  messages: ReturnType<typeof useMessages>["workflows"],
): boolean {
  const source = mappingSourceView(
    model,
    choice.output,
    locale,
    messages.fields,
    (number) => `${number}`,
  );
  if (source === undefined) return false;
  const text = [source.name, source.field, messages.mappingTypes[source.kind]]
    .join(" ")
    .toLocaleLowerCase();
  return text.includes(query.trim().toLocaleLowerCase().replaceAll("ي", "ی").replaceAll("ك", "ک"));
}
export function VariablePicker({ open, model, onChoose, onClose, onCloseAutoFocus }: Props) {
  const t = useAppTranslations("workflows");
  const locale = useLocale();
  const messages = useMessages().workflows;
  const [stored, setStored] = useState({ open, search: "" });
  const current = stored.open === open ? stored : { open, search: "" };
  if (current !== stored) setStored(current);
  const choices =
    model.state === "denied"
      ? []
      : model.choices.filter((choice) =>
          sourceMatches(choice, model, current.search, locale, messages),
        );
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent onCloseAutoFocus={onCloseAutoFocus} className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("mappingPickerTitle")}</DialogTitle>
          <DialogDescription>{t("mappingPickerHint")}</DialogDescription>
        </DialogHeader>
        <Input
          aria-label={t("mappingSearch")}
          maxLength={200}
          value={current.search}
          onChange={(event) => setStored({ open, search: event.currentTarget.value.slice(0, 200) })}
        />
        {model.state === "denied" ? (
          <p>{t("mappingDenied")}</p>
        ) : (
          <div className="space-y-2">
            {model.state === "incomplete" && <p>{t("mappingIncomplete")}</p>}
            {choices.map((choice) => (
              <SourceChoice
                key={mappingReferenceKey(choice.binding)}
                choice={choice}
                model={model}
                onChoose={onChoose}
              />
            ))}
            {choices.length === 0 && <p>{t("mappingNoSources")}</p>}
          </div>
        )}
        {current.search !== "" && (
          <Button variant="ghost" onClick={() => setStored({ open, search: "" })}>
            {t("clearSearch")}
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
