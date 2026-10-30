"use client";
import { useRouter } from "next/navigation";
import type React from "react";
import { useId, useRef, useState } from "react";
import { useActionError } from "@/components/shell/ActionErrorProvider";
import { Input } from "@/components/ui/Input";
import { MAX_DAILY_ACTIVITY_TARGET, MIN_DAILY_ACTIVITY_TARGET } from "@/constants/activityLoad";
import { useInvalidateActivityLists } from "@/features/activities/useInvalidateActivityLists";
import { useLocale } from "@/features/i18n/LocaleProvider";
import type { Locale } from "@/features/i18n/registry";
import { setDailyActivityTargetAction } from "@/features/identity/preferencesActions";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";
import { useFormatters } from "@/lib/useFormatters";
import { readCsrfToken } from "@/utils/csrfCookie";
import { normalizeNumberInput } from "@/utils/normalizeNumberInput";
import { SettingsCard, SettingsCardBody, SettingsCardHeader } from "../SettingsSurface";

function parseTarget(draft: string, locale: Locale): number | null {
  const trimmed = draft.trim();
  if (trimmed === "") return null;
  const normalized = normalizeNumberInput(trimmed, locale);
  if (normalized === null) return null;
  const value = Number(normalized);
  if (!Number.isInteger(value)) return null;
  if (value < MIN_DAILY_ACTIVITY_TARGET || value > MAX_DAILY_ACTIVITY_TARGET) return null;
  return value;
}

export function DailyActivityTarget({ target }: { target: number }): React.ReactNode {
  const L = useSettingsMessages();
  const S = L.dailyActivityTarget;
  const format = useFormatters();
  const locale = useLocale();

  const router = useRouter();
  const reportError = useActionError();
  const invalidateActivityLists = useInvalidateActivityLists();
  const fieldId = useId();
  const [displayTarget, setDisplayTarget] = useState(target);
  const [rawDraft, setRawDraft] = useState<{ raw: string; locale: Locale } | null>(null);
  // Keep typed drafts verbatim, including invalid input. Resting/committed values follow the
  // current digit preference without rewriting unfinished work when that preference changes.
  const draft =
    rawDraft?.raw ?? format.number(displayTarget, { useGrouping: false, maximumFractionDigits: 0 });
  const committedRef = useRef(target);
  const persistedRef = useRef(target);
  const revisionRef = useRef(0);
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve());

  function failWrite(revision: number, errorId?: string): void {
    const supersededByALaterCommit = revision !== revisionRef.current;
    if (supersededByALaterCommit) return;
    const persisted = persistedRef.current;
    committedRef.current = persisted;
    setDisplayTarget(persisted);
    setRawDraft(null);
    reportError(errorId);
  }

  async function persist(next: number, revision: number): Promise<void> {
    try {
      const r = await setDailyActivityTargetAction({ target: next }, readCsrfToken());
      if (!r.ok) {
        failWrite(revision, r.error.id);
        return;
      }
    } catch {
      failWrite(revision);
      return;
    }
    persistedRef.current = next;
    void invalidateActivityLists();
    if (revision !== revisionRef.current) return;
    router.refresh();
  }

  function commit(): void {
    const current = committedRef.current;
    const next = parseTarget(draft, rawDraft?.locale ?? locale);
    if (next === null || next === current) {
      setDisplayTarget(current);
      setRawDraft(null);
      return;
    }
    const revision = ++revisionRef.current;
    committedRef.current = next;
    setDisplayTarget(next);
    setRawDraft(null);
    writeQueueRef.current = writeQueueRef.current.then(() => persist(next, revision));
  }

  return (
    <SettingsCard>
      <SettingsCardHeader title={S.heading} description={S.description} />
      <SettingsCardBody>
        <label htmlFor={fieldId} className="mb-1 block text-sm font-medium">
          {S.label}
        </label>
        <Input
          id={fieldId}
          type="text"
          inputMode="numeric"
          min={MIN_DAILY_ACTIVITY_TARGET}
          max={MAX_DAILY_ACTIVITY_TARGET}
          step={1}
          className="w-24"
          value={draft}
          onChange={(e) => {
            const raw = e.target.value;
            setRawDraft((previous) => ({ raw, locale: previous?.locale ?? locale }));
          }}
          onBlur={() => {
            commit();
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            commit();
          }}
        />
      </SettingsCardBody>
    </SettingsCard>
  );
}
