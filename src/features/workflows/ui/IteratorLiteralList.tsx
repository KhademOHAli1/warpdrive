"use client";

import { Plus, X } from "lucide-react";
import { useState } from "react";
import type { z } from "zod";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/Popover";
import { Select } from "@/components/ui/Select";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import { useFormatters } from "@/lib/useFormatters";
import { numericLiteralFromInput } from "../mappingLiteralIntent";
import {
  workflowIteratorLiteralItems,
  workflowIteratorMaxItems,
  workflowIteratorMaxTextLength,
} from "../workflowIteratorRuntimeContract";

const copy = {
  en: {
    placeholder: "Enter an item",
    type: "Item type",
    value: "Item value",
    add: "Add item",
    update: "Update item",
    remove: "Remove item",
    useNull: "Use null",
    useValue: "Enter a value",
  },
  de: {
    placeholder: "Element eingeben",
    type: "Elementtyp",
    value: "Elementwert",
    add: "Element hinzufügen",
    update: "Element aktualisieren",
    remove: "Element entfernen",
    useNull: "Null verwenden",
    useValue: "Wert eingeben",
  },
  fa: {
    placeholder: "یک مورد وارد کنید",
    type: "نوع مورد",
    value: "مقدار مورد",
    add: "افزودن مورد",
    update: "به‌روزرسانی مورد",
    remove: "حذف مورد",
    useNull: "استفاده از مقدار تهی",
    useValue: "وارد کردن مقدار",
  },
};

export type IteratorLiteralItems = z.infer<typeof workflowIteratorLiteralItems>;
type Item = IteratorLiteralItems["items"][number];
const itemKinds = ["text", "number", "boolean"] as const;
export const emptyIteratorItems: IteratorLiteralItems = {
  kind: "literal",
  itemKind: "text",
  items: [],
};

interface Props {
  label: string;
  value: IteratorLiteralItems;
  editable: boolean;
  invalid: boolean;
  describedBy?: string;
  onChange: (value: IteratorLiteralItems) => void;
}

function itemLabel(
  item: Item,
  t: ReturnType<typeof useAppTranslations<"workflows">>,
  format: ReturnType<typeof useFormatters>,
) {
  if (item === null) return t("configurationNullValue");
  if (typeof item === "boolean") return t(item ? "boolTrue" : "boolFalse");
  return typeof item === "number" ? format.number(item) : item;
}

function editedValue(
  raw: string | null,
  kind: IteratorLiteralItems["itemKind"],
  locale: ReturnType<typeof useLocale>,
) {
  if (raw === null) return null;
  if (kind === "boolean") return raw === "true";
  if (kind === "text") return raw.trim() === "" ? undefined : raw.trim();
  const parsed = numericLiteralFromInput(raw, locale).value;
  return typeof parsed === "number" ? parsed : undefined;
}

function LiteralItemEditor({
  value,
  label,
  onChange,
}: Pick<Props, "value" | "label" | "onChange">) {
  const t = useAppTranslations("workflows");
  const locale = useLocale();
  const text = copy[locale];
  const format = useFormatters();
  const [draft, setDraft] = useState<{ index?: number; raw: string | null }>({ raw: "" });
  const raw = value.itemKind === "boolean" && draft.raw === "" ? "true" : draft.raw;
  const item = editedValue(raw, value.itemKind, locale);
  const parsed = workflowIteratorLiteralItems.safeParse({
    ...value,
    items:
      draft.index === undefined
        ? [...value.items, item]
        : value.items.map((existing, index) => (index === draft.index ? item : existing)),
  });
  const full = value.items.length >= workflowIteratorMaxItems && draft.index === undefined;
  function commit() {
    if (!parsed.success || full) return;
    onChange(parsed.data);
    setDraft({ raw: "" });
  }
  return (
    <PopoverContent aria-label={label} className="w-72 max-w-[calc(100vw-2rem)] space-y-2">
      <Select
        ariaLabel={text.type}
        value={value.itemKind}
        disabled={value.items.length !== 0}
        options={itemKinds.map((kind) => ({ value: kind, label: t(`mappingTypes.${kind}`) }))}
        onChange={(next) => {
          const itemKind = itemKinds.find((kind) => kind === next);
          if (itemKind === undefined || value.items.length !== 0) return;
          onChange({ ...emptyIteratorItems, itemKind });
          setDraft({ raw: "" });
        }}
      />
      {value.items.length !== 0 && (
        <ol className="max-h-48 space-y-1 overflow-y-auto">
          {value.items.map((existing, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: Literal slots are positional and may contain duplicate values.
            <li key={index} className="flex min-w-0 items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                className="min-w-0 flex-1 justify-start"
                aria-pressed={draft.index === index}
                onClick={() =>
                  setDraft({
                    index,
                    raw:
                      typeof existing === "number"
                        ? format.number(existing, {
                            useGrouping: false,
                            maximumSignificantDigits: 21,
                          })
                        : existing === null
                          ? null
                          : String(existing),
                  })
                }
              >
                <bdi className="truncate">{itemLabel(existing, t, format)}</bdi>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`${text.remove} ${format.number(index + 1)}`}
                onClick={() => {
                  onChange({
                    ...value,
                    items: value.items.filter((_, current) => current !== index),
                  });
                  setDraft({ raw: "" });
                }}
              >
                <X aria-hidden="true" size={14} />
              </Button>
            </li>
          ))}
        </ol>
      )}
      {value.itemKind === "boolean" ? (
        <Select
          ariaLabel={text.value}
          value={raw ?? "null"}
          disabled={full}
          options={[
            { value: "true", label: t("boolTrue") },
            { value: "false", label: t("boolFalse") },
            { value: "null", label: t("configurationNullValue") },
          ]}
          onChange={(next) => setDraft({ ...draft, raw: next === "null" ? null : next })}
        />
      ) : (
        <div className="flex min-w-0 items-center gap-1">
          <Input
            aria-label={text.value}
            placeholder={raw === null ? t("configurationNullValue") : text.placeholder}
            value={raw ?? ""}
            dir={value.itemKind === "number" ? "ltr" : "auto"}
            inputMode={value.itemKind === "number" ? "decimal" : undefined}
            maxLength={workflowIteratorMaxTextLength * 2}
            disabled={full || raw === null}
            onChange={(event) => setDraft({ ...draft, raw: event.currentTarget.value })}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
              event.preventDefault();
              event.stopPropagation();
              commit();
            }}
          />
          <Button
            size="sm"
            variant="ghost"
            disabled={full}
            onClick={() => setDraft({ ...draft, raw: raw === null ? "" : null })}
          >
            {raw === null ? text.useValue : text.useNull}
          </Button>
        </div>
      )}
      <div className="flex gap-1">
        <Button size="sm" variant="outline" disabled={full || !parsed.success} onClick={commit}>
          {draft.index === undefined && <Plus aria-hidden="true" size={14} />}
          {draft.index === undefined ? text.add : text.update}
        </Button>
        {draft.index !== undefined && (
          <Button size="sm" variant="ghost" onClick={() => setDraft({ raw: "" })}>
            {t("cancel")}
          </Button>
        )}
      </div>
    </PopoverContent>
  );
}

export function IteratorLiteralList({
  label,
  value,
  editable,
  invalid,
  describedBy,
  onChange,
}: Props) {
  const t = useAppTranslations("workflows");
  const text = copy[useLocale()];
  const format = useFormatters();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="min-w-0 flex-1 justify-start"
          aria-label={label}
          aria-invalid={invalid}
          aria-describedby={describedBy}
        >
          {value.items.length === 0 ? (
            <span className="truncate text-muted-foreground">
              {editable ? text.placeholder : "—"}
            </span>
          ) : (
            value.items.slice(0, 3).map((item, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: Literal slots are positional and may contain duplicate values.
              <Badge key={index} variant="secondary" className="min-w-0 shrink px-1.5 py-0">
                <bdi className="truncate">{itemLabel(item, t, format)}</bdi>
              </Badge>
            ))
          )}
          {value.items.length > 3 && <span>+{format.number(value.items.length - 3)}</span>}
        </Button>
      </PopoverTrigger>
      {editable ? (
        <LiteralItemEditor value={value} label={label} onChange={onChange} />
      ) : (
        <PopoverContent aria-label={label} className="max-w-72">
          {value.items.length === 0 ? (
            "—"
          ) : (
            <ol className="max-h-48 space-y-1 overflow-y-auto">
              {value.items.map((item, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: Literal slots are positional and may contain duplicate values.
                <li key={index} className="break-words">
                  <bdi>{itemLabel(item, t, format)}</bdi>
                </li>
              ))}
            </ol>
          )}
        </PopoverContent>
      )}
    </Popover>
  );
}
