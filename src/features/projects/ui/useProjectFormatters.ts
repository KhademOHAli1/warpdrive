"use client";

import { useSyncExternalStore } from "react";
import type { DateDisplayOptions } from "@/lib/localeFormatting";
import { useFormatters } from "@/lib/useFormatters";

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

export function useProjectFormatters() {
  const format = useFormatters();
  const hydrated = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);

  // Bun and the browser can use different ICU punctuation for the same account locale.
  // Start with a stable ISO date, then format it using the browser's account preferences.
  return {
    number: format.number,
    dateOnly: (value: string) => (hydrated ? format.dateOnly(value) : value),
    dateTime: (value: string, options?: DateDisplayOptions) =>
      hydrated ? format.dateTime(value, options) : value.slice(0, 10),
  };
}
