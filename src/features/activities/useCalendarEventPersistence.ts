"use client";
import { useRef, useState } from "react";
import { useNativeActor } from "@/features/identity/NativeActorProvider";
import { readCsrfToken } from "@/utils/csrfCookie";
import { readCalendarEventAction } from "./calendarNativeActions";
import type { EditableActivity } from "./getForEdit";
import { useInvalidateActivityLists } from "./useInvalidateActivityLists";

type MutationKind = "save" | "delete" | "complete" | "retry";
type MutationResult = { ok: true; value: { id: string } } | { ok: false; error: { id: string } };
interface Acknowledged {
  id: string;
  kind: MutationKind;
}

export function useCalendarEventPersistence({
  onRead,
  onConfirmed,
  onClose,
  onSaved,
  onFailure,
}: {
  onRead: (event: EditableActivity) => void;
  onConfirmed: (kind: MutationKind, id: string) => void;
  onClose: () => void;
  onSaved?: () => void;
  onFailure: (kind: MutationKind | "read", errorId: string) => void;
}) {
  const actor = useNativeActor();
  const [actorId] = useState(actor.actorId);
  const active = () => actorId !== null && actor.actorId === actorId && actor.isCurrent();
  const busy = useRef(false);
  const acknowledged = useRef<Acknowledged | null>(null);
  const invalidate = useInvalidateActivityLists();
  const [pending, setPending] = useState(false);
  const [recovery, setRecovery] = useState<"saved" | "unknown" | null>(null);

  async function read(id: string): Promise<boolean> {
    if (!active()) return false;
    const result = await readCalendarEventAction(
      { v: 1, expectedActorId: actorId, activityId: id },
      readCsrfToken(),
    );
    if (!active()) return false;
    if (!result.ok) {
      onFailure("read", result.error.id);
      return false;
    }
    onRead(result.value);
    return true;
  }
  async function reconcile(saved: Acknowledged): Promise<void> {
    if (saved.kind !== "delete" && !(await read(saved.id))) return;
    if (!active()) return;
    await invalidate();
    if (!active()) return;
    acknowledged.current = null;
    setRecovery(null);
    onSaved?.();
    if (saved.kind === "save" || saved.kind === "delete") onClose();
  }
  async function run(task: () => Promise<void>): Promise<void> {
    if (busy.current || !active()) return;
    busy.current = true;
    setPending(true);
    try {
      await task();
    } finally {
      busy.current = false;
      if (active()) setPending(false);
    }
  }
  async function mutate(
    kind: MutationKind,
    dispatch: () => Promise<MutationResult>,
  ): Promise<void> {
    if (recovery !== null) return;
    await run(async () => {
      let result: MutationResult;
      try {
        result = await dispatch();
      } catch {
        if (active()) setRecovery("unknown");
        return;
      }
      if (!active()) return;
      if (!result.ok) {
        onFailure(kind, result.error.id);
        return;
      }
      const saved = { id: result.value.id, kind };
      acknowledged.current = saved;
      setRecovery("saved");
      onConfirmed(kind, saved.id);
      try {
        await reconcile(saved);
      } catch {
        /* A known save remains read-only until its refresh succeeds. */
      }
    });
  }
  async function recover(): Promise<void> {
    await run(async () => {
      if (acknowledged.current !== null) {
        try {
          await reconcile(acknowledged.current);
        } catch {
          /* Keep the acknowledgment. */
        }
      } else if (recovery === "unknown") {
        // Absence from a list cannot prove that a lost response did not commit.
        // Leave this draft intact until the user explicitly opens Calendar.
        try {
          await invalidate();
        } catch {
          /* Calendar can refresh when opened. */
        }
        if (active()) {
          onSaved?.();
          onClose();
        }
      }
    });
  }
  async function refresh(id: string): Promise<void> {
    if (recovery !== null) return;
    await run(async () => {
      try {
        await read(id);
      } catch {
        if (active()) onFailure("read", "");
      }
    });
  }
  return {
    actorId,
    active,
    pending,
    recovery,
    mutate,
    recover,
    refresh,
    canClose: () => !busy.current,
    canEdit: actorId !== null && actor.actorId === actorId && recovery === null,
  };
}
