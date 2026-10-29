"use client";
import { useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/Popover";
import { Tip } from "@/components/ui/tooltip";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { cn } from "@/lib/utils";

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const COLOR_OPTIONS = [
  { key: "black", value: "#000000" },
  { key: "slate", value: "#475569" },
  { key: "red", value: "#dc2626" },
  { key: "orange", value: "#ea580c" },
  { key: "amber", value: "#d97706" },
  { key: "green", value: "#16a34a" },
  { key: "teal", value: "#0d9488" },
  { key: "blue", value: "#2563eb" },
  { key: "indigo", value: "#4f46e5" },
  { key: "purple", value: "#9333ea" },
  { key: "pink", value: "#db2777" },
  { key: "white", value: "#ffffff" },
] as const;

interface ColorPickerProps {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  triggerClassName?: string;
}

export function ColorPicker({
  value,
  onChange,
  ariaLabel,
  triggerClassName,
}: ColorPickerProps): React.ReactNode {
  const inputId = useId();
  const t = useAppTranslations("sharedUi");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [invalid, setInvalid] = useState(false);

  function handleOpenChange(next: boolean): void {
    setOpen(next);
    if (next) {
      setDraft(value);
      setInvalid(false);
    }
  }

  function choose(next: string): void {
    onChange(next);
    setOpen(false);
  }

  function applyCustom(): void {
    const normalized = draft.trim().toLowerCase();
    if (!HEX_COLOR.test(normalized)) {
      setInvalid(true);
      return;
    }
    choose(normalized);
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <Tip label={ariaLabel}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={ariaLabel}
            className={cn("relative", triggerClassName)}
          >
            <span
              aria-hidden="true"
              className="size-4 rounded-full ring-1 ring-black/10 dark:ring-white/10"
              style={{ backgroundColor: value }}
            />
          </Button>
        </PopoverTrigger>
      </Tip>
      <PopoverContent
        className="w-52 space-y-3 p-3"
        aria-label={t("colorOptions", { label: ariaLabel })}
      >
        <div className="grid grid-cols-4 gap-1">
          {COLOR_OPTIONS.map((color) => (
            <Button
              key={color.value}
              variant="ghost"
              size="icon"
              aria-label={t(`colors.${color.key}`)}
              aria-pressed={value.toLowerCase() === color.value}
              onClick={() => choose(color.value)}
              className="size-10 p-2"
            >
              <span
                aria-hidden="true"
                className="size-5 rounded-full ring-1 ring-black/10 dark:ring-white/10"
                style={{ backgroundColor: color.value }}
              />
            </Button>
          ))}
        </div>
        <form
          className="space-y-2 border-t pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            applyCustom();
          }}
        >
          <label htmlFor={inputId} className="block text-xs font-medium">
            {t("customHexColor")}
          </label>
          <Input
            id={inputId}
            name="customHexColor"
            dir="ltr"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder={t("hexPlaceholder")}
            maxLength={7}
          />
          {invalid ? (
            <p role="alert" className="text-xs text-destructive">
              {t("invalidHexColor")}
            </p>
          ) : null}
          <Button type="submit" size="sm" className="w-full">
            {t("applyColor")}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
