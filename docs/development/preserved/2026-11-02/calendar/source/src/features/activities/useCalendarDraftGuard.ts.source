"use client";
import { type RefObject, useEffect, useState } from "react";
import { maskTime } from "@/components/ui/timeFormat";
import type { ActivityDraft } from "@/features/deal-workspace/composer/composerHelpers";

export function useCalendarDraftGuard({
  draft,
  initial,
  fields,
  pending,
  onClose,
  extraChanged = false,
}: {
  draft: ActivityDraft;
  initial: ActivityDraft;
  fields: RefObject<HTMLFieldSetElement | null>;
  pending: boolean;
  onClose: () => void;
  extraChanged?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  function hasChanges(): boolean {
    if (dirty || extraChanged) return true;
    const clocks = fields.current?.querySelectorAll<HTMLInputElement>("[data-time-picker]");
    return (
      clocks !== undefined &&
      Array.from(clocks)
        .filter((input) => input.closest("[data-reminder-input]") === null)
        .some((input, index) => maskTime(input.value) !== [draft.startTime, draft.endTime][index])
    );
  }
  useEffect(() => {
    function unload(event: BeforeUnloadEvent): void {
      if (!pending && !hasChanges()) return;
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  });
  return {
    open,
    setOpen,
    requestClose: () => {
      if (pending) return;
      if (hasChanges()) setOpen(true);
      else onClose();
    },
    discard: () => {
      if (!pending) onClose();
    },
  };
}
