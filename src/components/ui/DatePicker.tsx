"use client";
import dynamic from "next/dynamic";
import type React from "react";
import { useMemo, useState } from "react";
import type { Labels, Modifiers } from "react-day-picker";
import { useLocale, useMessages, useNumberingSystem } from "@/features/i18n/LocaleProvider";
import type { Locale } from "@/features/i18n/locale";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "./Button";
import { type DayAccessory, dayAccessoryButton } from "./DayAccessoryButton";
import {
  formatGregorianPersianDate,
  formatMdy,
  formatPersianAccessibleDate,
  formatPersianDate,
  parseYmd,
  toYmd,
} from "./dateFormat";
import { Popover, PopoverContent, PopoverTrigger } from "./Popover";

// react-day-picker is a mid-weight calendar lib that only renders inside the popover, i.e. after
// the user opens it. Code-split it so every route that merely mounts a DatePicker (deal page,
// dashboard, inline date edits, add-deal/add-lead forms) does not ship the calendar in its initial
// chunk. It is warmed on trigger hover/focus (preloadDayPicker) so the popover opens without a
// load flash in the common case.
const DayPicker = dynamic(async () => (await import("react-day-picker")).DayPicker, {
  ssr: false,
  loading: () => <div className="min-h-[18rem]" aria-hidden="true" />,
});
const PersianDayPicker = dynamic(async () => (await import("@daypicker/persian")).DayPicker, {
  ssr: false,
  loading: () => <div className="min-h-[18rem]" aria-hidden="true" />,
});
const PersianEnglishDayPicker = dynamic(
  async () => (await import("./localizedDayPickers")).PersianEnglishCalendar,
  { ssr: false, loading: () => <div className="min-h-[18rem]" aria-hidden="true" /> },
);
const GregorianPersianDayPicker = dynamic(
  async () => (await import("./localizedDayPickers")).GregorianPersianCalendar,
  { ssr: false, loading: () => <div className="min-h-[18rem]" aria-hidden="true" /> },
);

function preloadDayPicker(): void {
  void import("react-day-picker");
}

// react-day-picker v10's captionLayout="dropdown" defaults navEnd to Dec 31
// of the current year when startMonth/endMonth are omitted, which caps the
// next-month chevron and year dropdown there and makes any future date
// unreachable. These bound the navigable range explicitly instead: far
// enough back for historical deal/lead dates, far enough forward that the
// year dropdown parity feature (Pipedrive) stays usable for years to come.
const DATE_PICKER_PAST_YEARS = 100;
const DATE_PICKER_FUTURE_YEARS = 20;

interface DatePickerProps {
  value: string | null;
  onChange: (v: string | null) => void;
  ariaLabel: string;
  placeholder?: string;
  // Replaces the default bordered-button trigger styling (e.g. the deal Summary renders the
  // trigger as a plain text/CTA row, Pipedrive-style). Also applied to the empty-state
  // placeholder span so a CTA trigger can style "Set expected close date" as a link.
  triggerClassName?: string;
  placeholderClassName?: string;
  // Overrides the Gregorian trigger's set-value text (default MM/DD/YYYY).
  formatLabel?: (ymd: string) => string;
  // Opens the calendar popover on mount (PD's inline date editor shows the calendar
  // immediately when the field enters edit mode).
  defaultOpen?: boolean;
  dayAccessory?: (localYmd: string) => DayAccessory | null;
  onMonthChange?: (month: Date) => void;
  onOpenChange?: (open: boolean) => void;
  onCalendarChange?: (calendar: CalendarSystem) => void;
}

export type CalendarSystem = "gregory" | "persian";

function persianLabels(
  calendar: CalendarSystem,
  numberingSystem: "latn" | "arabext",
): Partial<Labels> {
  const label = (date: Date, modifiers?: Modifiers): string =>
    formatPersianAccessibleDate(date, calendar, modifiers, numberingSystem);
  return { labelDayButton: label, labelGridcell: label };
}

function dateLabel(
  value: string | null,
  calendar: CalendarSystem,
  locale: Locale,
  formatLabel?: (ymd: string) => string,
  numberingSystem?: "latn" | "arabext",
): string {
  if (value === null) return "";
  if (calendar === "persian") return formatPersianDate(value, locale, numberingSystem);
  if (locale === "fa") return formatGregorianPersianDate(value, numberingSystem);
  return (formatLabel ?? formatMdy)(value);
}

// Popover + react-day-picker calendar. Value/onChange use local YYYY-MM-DD so
// this drops into the existing date inputs (composer, add-deal, add-lead) with
// no change to their action payloads. The displayed calendar can be switched independently.
export function DatePicker({
  value,
  onChange,
  ariaLabel,
  placeholder,
  triggerClassName,
  placeholderClassName,
  formatLabel,
  defaultOpen = false,
  dayAccessory,
  onMonthChange,
  onOpenChange,
  onCalendarChange,
}: DatePickerProps): React.ReactNode {
  const locale = useLocale();
  const numberingSystem = useNumberingSystem();
  const { datePicker: messages } = useMessages();
  const [open, setOpenState] = useState(defaultOpen);
  const [calendarOverride, setCalendarOverride] = useState<CalendarSystem | null>(null);
  const calendar = calendarOverride ?? (locale === "fa" ? "persian" : "gregory");
  const setOpen = (next: boolean): void => {
    setOpenState(next);
    onOpenChange?.(next);
  };
  const selected = value !== null ? (parseYmd(value) ?? undefined) : undefined;
  const label = dateLabel(value, calendar, locale, formatLabel, numberingSystem);
  const currentYear = new Date().getFullYear();
  const startMonth = new Date(currentYear - DATE_PICKER_PAST_YEARS, 0);
  const endMonth = new Date(currentYear + DATE_PICKER_FUTURE_YEARS, 11);
  const components = useMemo(
    () =>
      dayAccessory === undefined ? undefined : { DayButton: dayAccessoryButton(dayAccessory) },
    [dayAccessory],
  );
  const Picker =
    calendar === "persian"
      ? locale === "fa"
        ? PersianDayPicker
        : PersianEnglishDayPicker
      : locale === "fa"
        ? GregorianPersianDayPicker
        : DayPicker;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={ariaLabel}
        onMouseEnter={preloadDayPicker}
        onFocus={preloadDayPicker}
        className={
          triggerClassName ?? cn(buttonVariants({ variant: "outline", size: "sm" }), "font-normal")
        }
      >
        {label === "" ? (
          <span className={placeholderClassName ?? "text-muted-foreground"}>
            {placeholder ?? messages.selectDate}
          </span>
        ) : (
          label
        )}
      </PopoverTrigger>
      <PopoverContent>
        <Picker
          mode="single"
          labels={locale === "fa" ? persianLabels(calendar, numberingSystem) : undefined}
          numerals={numberingSystem}
          selected={selected}
          defaultMonth={selected}
          weekStartsOn={calendar === "persian" ? 6 : undefined}
          onSelect={(day) => {
            if (day !== undefined) {
              onChange(toYmd(day));
              setOpen(false);
            }
          }}
          captionLayout="dropdown"
          startMonth={startMonth}
          endMonth={endMonth}
          onMonthChange={onMonthChange}
          components={components}
        />
        <div className="flex items-center justify-between gap-2 border-t pt-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              const next = calendar === "gregory" ? "persian" : "gregory";
              setCalendarOverride(next);
              onCalendarChange?.(next);
            }}
            className="h-8 text-xs text-muted-foreground hover:text-foreground"
          >
            {calendar === "gregory" ? messages.usePersianCalendar : messages.useGregorianCalendar}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
            className="h-8 text-xs text-muted-foreground hover:text-foreground"
          >
            {messages.clear}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
