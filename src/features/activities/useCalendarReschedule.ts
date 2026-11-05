"use client";

import { useRef, useState } from "react";
import { useAppTranslations, useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { useNativeActor } from "@/features/identity/NativeActorProvider";
import { readCsrfToken } from "@/utils/csrfCookie";
import type { CalendarActivity } from "./calendar";
import { rescheduleCalendarEventAction } from "./calendarRescheduleAction";
import { calendarScheduleSnapshot } from "./calendarReschedulePlan";
import type {
  CalendarRescheduleActionResult,
  CalendarRescheduleEnvelope,
  CalendarRescheduleInput,
  CalendarRescheduleValue,
} from "./calendarRescheduleSchemas";
import { useInvalidateActivityLists } from "./useInvalidateActivityLists";

export type CalendarRescheduleTarget = CalendarRescheduleInput["target"];
export type CalendarMoveResult =
  | { kind: "saved"; schedule: CalendarRescheduleValue }
  | { kind: "stale" | "rejected" | "unknown" | "ignored" };

type FailureKey = "moveStale" | "moveDenied" | "moveActorMissing" | "moveFailed";

function moveFailure(id: string): {
  kind: "stale" | "rejected";
  key: FailureKey;
  refresh: boolean;
} {
  if (id === "E_ACTIVITY_011" || id === "E_ACTIVITY_010")
    return { kind: "stale", key: "moveStale", refresh: true };
  if (id === "E_ACTIVITY_001") return { kind: "rejected", key: "moveFailed", refresh: true };
  if (id === "E_ACTIVITY_002" || id === "E_PERM_001")
    return { kind: "rejected", key: "moveDenied", refresh: false };
  if (id === "E_AUTH_003" || id === "E_AUTH_CSRF")
    return { kind: "rejected", key: "moveActorMissing", refresh: true };
  return { kind: "rejected", key: "moveFailed", refresh: false };
}

export function useCalendarReschedule({
  onMoved,
  onRefresh,
}: {
  onMoved?: (schedule: CalendarRescheduleValue) => void;
  onRefresh: () => void | Promise<void>;
}) {
  const actor = useNativeActor();
  const [actorId] = useState(actor.actorId);
  const preferences = useLocalePreferences();
  const t = useAppTranslations("calendar");
  const invalidate = useInvalidateActivityLists();
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const active = () => actorId !== null && actor.actorId === actorId && actor.isCurrent();

  async function refresh(): Promise<boolean> {
    if (!active()) return false;
    let invalidated = true;
    try {
      await invalidate();
    } catch {
      invalidated = false;
    }
    if (!active()) return false;
    try {
      await onRefresh();
    } catch {
      return false;
    }
    return active() && invalidated;
  }

  async function confirmed(schedule: CalendarRescheduleValue): Promise<CalendarMoveResult> {
    setNotice(t("interaction.moveSaved"));
    let displayed = true;
    try {
      onMoved?.(schedule);
    } catch {
      // The server acknowledgment remains valid if displaying or refreshing its result fails.
      displayed = false;
    }
    const refreshed = await refresh();
    if (!active()) return { kind: "ignored" };
    if (!displayed || !refreshed) setError(t("interaction.moveRefreshFailed"));
    return { kind: "saved", schedule };
  }

  async function dispatch(input: CalendarRescheduleEnvelope): Promise<CalendarMoveResult> {
    let result: CalendarRescheduleActionResult;
    try {
      result = await rescheduleCalendarEventAction(input, readCsrfToken());
    } catch {
      if (!active()) return { kind: "ignored" };
      setError(t("interaction.moveUnknown"));
      // A refreshed list can reconcile display, but cannot acknowledge this lost response.
      await refresh();
      return active() ? { kind: "unknown" } : { kind: "ignored" };
    }
    if (!active()) return { kind: "ignored" };
    if (result.ok) return confirmed(result.value);
    const failure = moveFailure(result.error.id);
    setError(t(`interaction.${failure.key}`));
    if (failure.refresh) await refresh();
    return active() ? { kind: failure.kind } : { kind: "ignored" };
  }

  async function move(
    activity: CalendarActivity,
    target: CalendarRescheduleTarget,
  ): Promise<CalendarMoveResult> {
    if (busy.current) return { kind: "ignored" };
    setError(null);
    setNotice(null);
    if (!active() || actorId === null) {
      setError(t("interaction.moveActorMissing"));
      return { kind: "ignored" };
    }
    let input: CalendarRescheduleEnvelope;
    try {
      input = {
        v: 1,
        expectedActorId: actorId,
        activity: {
          id: activity.id,
          timeZone: preferences.timeZone,
          expected: calendarScheduleSnapshot(activity),
          target: { ...target },
        },
      };
    } catch {
      setError(t("interaction.moveFailed"));
      return { kind: "rejected" };
    }
    busy.current = true;
    setPending(true);
    try {
      return await dispatch(input);
    } finally {
      busy.current = false;
      if (active()) setPending(false);
    }
  }

  function clearFeedback(): void {
    if (busy.current) return;
    setError(null);
    setNotice(null);
  }

  return {
    pending,
    error,
    notice,
    move,
    clearFeedback,
    // The server remains the authority; this only disables gestures without an actor snapshot.
    canMove: actorId !== null && actor.actorId === actorId,
  };
}
