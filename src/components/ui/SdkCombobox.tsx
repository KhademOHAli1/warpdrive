"use client";

import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  createComboboxController,
} from "@ui-sdk/react/combobox";
import { type RefObject, useCallback, useId, useRef, useState } from "react";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { cn } from "@/lib/utils";
import { buttonVariants } from "./Button";
import type { ComboboxOption } from "./Combobox";
import { ComboboxOptionLabel, ComboboxTriggerLabel } from "./comboboxPresentation";
import { useDirection } from "./direction";

export function SdkCombobox({
  value,
  onChange,
  options,
  ariaLabel,
  placeholder,
  triggerClassName,
  tabFromTrigger = false,
  disabled = false,
  triggerRef,
  popupRef,
}: {
  value: string;
  onChange: (value: string) => void;
  options: ComboboxOption[];
  ariaLabel: string;
  placeholder?: string;
  triggerClassName?: string;
  tabFromTrigger?: boolean;
  disabled?: boolean;
  triggerRef?: RefObject<HTMLButtonElement | null>;
  popupRef?: RefObject<HTMLDivElement | null>;
}) {
  const t = useAppTranslations("sharedUi");
  const direction = useDirection();
  const [controller] = useState(() => createComboboxController<string>());
  const triggerId = useId();
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  const bindTrigger = useCallback(
    (node: HTMLButtonElement | null) => {
      setTrigger(node);
      if (triggerRef !== undefined) triggerRef.current = node;
    },
    [triggerRef],
  );
  const localContent = useRef<HTMLDivElement>(null);
  const content = popupRef ?? localContent;
  const restoreFocus = useRef(false);
  const selected = options.find((option) => option.value === value);

  return (
    <Combobox<string>
      value={selected?.value ?? null}
      controller={controller}
      disabled={disabled}
      defaultQuery=""
      itemToLabel={(id) => options.find((option) => option.value === id)?.label ?? id}
      filter={(option, text) => option.label.toLowerCase().includes(text.toLowerCase())}
      autoHighlight="always"
      announcement={() => null}
      onValueChange={(next, { reason }) => {
        if (next !== null && reason === "item-press") onChange(next);
      }}
      onOpenChange={(open, { reason }) => {
        if (open) controller.setQuery("");
        restoreFocus.current = !open && (reason === "item-press" || reason === "escape-key");
      }}
      onOpenChangeComplete={(open) => {
        const focused = document.activeElement;
        if (
          !open &&
          restoreFocus.current &&
          (focused === document.body || content.current?.contains(focused) === true)
        ) {
          trigger?.focus();
        }
      }}
    >
      <ComboboxTrigger
        ref={bindTrigger}
        id={triggerId}
        aria-label={ariaLabel}
        data-crm-picker-trigger=""
        tabIndex={0}
        className={cn(
          buttonVariants({ variant: "outline", size: "sm" }),
          "w-full justify-between font-normal disabled:opacity-50",
          triggerClassName,
        )}
      >
        <ComboboxTriggerLabel option={selected} placeholder={placeholder ?? t("select")} />
      </ComboboxTrigger>
      <ComboboxContent
        ref={content}
        anchor={trigger}
        dir={direction}
        align="start"
        sideOffset={4}
        className="z-50 flex max-h-[var(--available-height)] min-w-40 max-w-[calc(100vw-1rem)] flex-col rounded-md border bg-popover text-popover-foreground shadow-md outline-none"
      >
        <ComboboxInput
          autoFocus
          placeholder={t("search")}
          aria-label={t("search")}
          className="w-full shrink-0 border-b px-2.5 py-2 text-sm outline-none"
          onKeyDown={(event) => {
            if (tabFromTrigger && event.key === "Tab") {
              // Use the trigger as the browser's Tab origin before the SDK hides the search input.
              trigger?.focus({ preventScroll: true });
              return;
            }
            if (event.key !== "Enter") return;
            if (
              event.repeat ||
              event.nativeEvent.isComposing ||
              event.nativeEvent.keyCode === 229
            ) {
              event.preventDefault();
              return;
            }
            if (event.currentTarget.hasAttribute("aria-activedescendant")) return;
            const text = event.currentTarget.value.trim().toLowerCase();
            if (options.filter((option) => option.label.toLowerCase() === text).length > 1) {
              event.preventDefault();
            }
          }}
        />
        <ComboboxEmpty className="px-2 py-3 text-sm text-muted-foreground">
          {t("noMatch")}
        </ComboboxEmpty>
        <ComboboxList aria-labelledby={triggerId} className="max-h-56 min-h-0 overflow-y-auto p-1">
          {options.map((option) => (
            <ComboboxItem
              key={option.value}
              value={option.value}
              label={option.label}
              aria-label={option.label}
              className="flex cursor-pointer items-center gap-1.5 rounded px-2 py-1.5 text-sm data-highlighted:bg-accent forced-colors:data-highlighted:outline-2 forced-colors:data-highlighted:-outline-offset-2 forced-colors:data-highlighted:outline-current"
            >
              <ComboboxOptionLabel option={option} selected={option.value === value} />
            </ComboboxItem>
          ))}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
