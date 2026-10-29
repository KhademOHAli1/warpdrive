"use client";

import { enUS, DayPicker as PersianDayPicker } from "@daypicker/persian";
import type React from "react";
import { DayPicker, type DayPickerProps } from "react-day-picker";
import { faIR } from "react-day-picker/locale/fa-IR";

export function PersianEnglishCalendar(props: DayPickerProps): React.ReactNode {
  return <PersianDayPicker {...props} locale={enUS} dir="ltr" numerals="latn" />;
}

export function GregorianPersianCalendar(props: DayPickerProps): React.ReactNode {
  return <DayPicker {...props} locale={faIR} dir="rtl" numerals={props.numerals ?? "arabext"} />;
}
