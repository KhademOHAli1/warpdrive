"use client";
import { useRef, useState } from "react";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
export type CalendarMutationResult = { ok: true } | { ok: false; error: { id: string } };
export function useCalendarMutation() {
  const active = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = useAppTranslations("calendar");
  async function run(work: () => Promise<CalendarMutationResult>): Promise<void> {
    if (active.current) return;
    active.current = true;
    setPending(true);
    setError(null);
    try {
      if (!(await work()).ok) setError(t("settings.saveFailed"));
    } catch {
      setError(t("settings.saveFailed"));
    } finally {
      active.current = false;
      setPending(false);
    }
  }
  return { pending, error, run };
}
