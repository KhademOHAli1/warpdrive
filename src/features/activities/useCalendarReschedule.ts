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

export type CalendarRescheduleTarget = Extract<CalendarRescheduleInput["target"], { date: string }>;
export type CalendarMoveResult =
  | { kind: "saved"; schedule: CalendarRescheduleValue }
  | { kind: "stale" | "rejected" | "unknown" | "ignored" };

type ScheduleOperation = "move" | "resize" | "undo";
type FailureKey =
  | "moveStale"
  | "moveDenied"
  | "moveActorMissing"
  | "moveFailed"
  | "resizeFailed"
  | "undoFailed";

const SAVED = { move: "moveSaved", resize: "resizeSaved", undo: "undoSaved" } as const;
const FAILED = { move: "moveFailed", resize: "resizeFailed", undo: "undoFailed" } as const;

function moveFailure(
  id: string,
  operation: ScheduleOperation,
): {
  kind: "stale" | "rejected";
  key: FailureKey;
  refresh: boolean;
} {
  if (id === "E_ACTIVITY_011" || id === "E_ACTIVITY_010")
    return { kind: "stale", key: "moveStale", refresh: true };
  if (id === "E_ACTIVITY_001") return { kind: "rejected", key: FAILED[operation], refresh: true };
  if (id === "E_ACTIVITY_002" || id === "E_PERM_001")
    return { kind: "rejected", key: "moveDenied", refresh: false };
  if (id === "E_AUTH_003" || id === "E_AUTH_CSRF")
    return { kind: "rejected", key: "moveActorMissing", refresh: true };
  return { kind: "rejected", key: FAILED[operation], refresh: false };
}

export function useCalendarReschedule({
  onMoved,
  onRefresh,
  onUncertain,
}: {
  onMoved?: (schedule: CalendarRescheduleValue) => void;
  onRefresh: () => void | Promise<void>;
  onUncertain?: (activityId: string) => void;
}) {
  const actor = useNativeActor();
  const [actorId] = useState(actor.actorId);
  const preferences = useLocalePreferences();
  const t = useAppTranslations("calendar");
  const invalidate = useInvalidateActivityLists();
  const busy = useRef(false);
  const [pendingOperation, setPendingOperation] = useState<ScheduleOperation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [undoInput, setUndoInput] = useState<CalendarRescheduleInput | null>(null);
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

  async function confirmed(
    input: CalendarRescheduleInput,
    result: Extract<CalendarRescheduleActionResult, { ok: true }>,
    operation: ScheduleOperation,
  ): Promise<CalendarMoveResult> {
    const schedule = result.value;
    setNotice(t(`interaction.${SAVED[operation]}`));
    if (result.undoToken !== undefined && operation !== "undo") {
      setUndoInput({
        id: input.id,
        timeZone: input.timeZone,
        expected: calendarScheduleSnapshot(schedule),
        target: { undo: input.expected, token: result.undoToken },
      });
    }
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

  async function dispatch(
    input: CalendarRescheduleEnvelope,
    operation: ScheduleOperation,
  ): Promise<CalendarMoveResult> {
    let result: CalendarRescheduleActionResult;
    try {
      result = await rescheduleCalendarEventAction(input, readCsrfToken());
    } catch {
      if (!active()) return { kind: "ignored" };
      setError(t("interaction.moveUnknown"));
      onUncertain?.(input.activity.id);
      // A refreshed list can reconcile display, but cannot acknowledge this lost response.
      await refresh();
      return active() ? { kind: "unknown" } : { kind: "ignored" };
    }
    if (!active()) return { kind: "ignored" };
    if (result.ok) return confirmed(input.activity, result, operation);
    const failure = moveFailure(result.error.id, operation);
    setError(t(`interaction.${failure.key}`));
    if (failure.kind === "stale") onUncertain?.(input.activity.id);
    if (failure.refresh) await refresh();
    return active() ? { kind: failure.kind } : { kind: "ignored" };
  }

  async function submit(
    input: CalendarRescheduleInput,
    operation: ScheduleOperation,
  ): Promise<CalendarMoveResult> {
    if (busy.current) return { kind: "ignored" };
    setError(null);
    setNotice(null);
    if (!active() || actorId === null) {
      setError(t("interaction.moveActorMissing"));
      return { kind: "ignored" };
    }
    setUndoInput(null);
    busy.current = true;
    setPendingOperation(operation);
    try {
      return await dispatch({ v: 1, expectedActorId: actorId, activity: input }, operation);
    } finally {
      busy.current = false;
      if (active()) setPendingOperation(null);
    }
  }

  async function change(
    activity: CalendarActivity,
    target: CalendarRescheduleTarget,
  ): Promise<CalendarMoveResult> {
    if (busy.current) return { kind: "ignored" };
    const operation = "edge" in target ? "resize" : "move";
    let expected: CalendarRescheduleInput["expected"];
    try {
      expected = calendarScheduleSnapshot(activity);
    } catch {
      setError(t(`interaction.${FAILED[operation]}`));
      setNotice(null);
      setUndoInput(null);
      return { kind: "rejected" };
    }
    return submit({ id: activity.id, timeZone: preferences.timeZone, expected, target }, operation);
  }

  async function undo(): Promise<CalendarMoveResult> {
    if (undoInput === null) return { kind: "ignored" };
    return submit(undoInput, "undo");
  }

  function clearFeedback(): void {
    if (busy.current) return;
    setError(null);
    setNotice(null);
    setUndoInput(null);
  }

  const canMove = actorId !== null && actor.actorId === actorId;
  return {
    pending: pendingOperation !== null,
    pendingOperation,
    error,
    notice,
    move: change,
    undo,
    undoAvailable: canMove && pendingOperation === null && undoInput !== null,
    clearFeedback,
    // The server remains the authority; this only disables gestures without an actor snapshot.
    canMove,
  };
}
