"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { useNativeActor } from "@/features/identity/NativeActorProvider";
import { readCsrfToken } from "@/utils/csrfCookie";
import { CalendarEventDialog } from "./CalendarEventDialog";
import { CalendarEventViewer } from "./CalendarEventViewer";
import { readCalendarEventAction } from "./calendarNativeActions";
import type { EditableActivity } from "./getForEdit";

// Each opening performs a fresh credential-bound read. A previous account's
// cached DTO cannot seed this form, and late results cannot cross an actor change.
export function CalendarEventEditDialog({
  id,
  onClose,
  onSaved,
  onMarkedDone,
}: {
  id: string;
  onClose: () => void;
  onSaved: () => void;
  onMarkedDone?: (id: string) => void;
}): React.ReactNode {
  const t = useAppTranslations("calendar");
  const actor = useNativeActor();
  const currentActor = useRef(actor);
  const actorId = actor.actorId;
  const [attempt, setAttempt] = useState(0);
  const readToken = useMemo(() => ({ actorId, id, attempt }), [actorId, id, attempt]);
  const latestAttempt = useRef(attempt);
  const currentRead = useRef(readToken);
  useLayoutEffect(() => {
    currentActor.current = actor;
    latestAttempt.current = attempt;
    currentRead.current = readToken;
  });
  const [readResult, setReadResult] = useState<{
    token: typeof readToken;
    event: EditableActivity | null;
  } | null>(null);
  const snapshot = readResult !== null && readResult.token === readToken ? readResult.event : null;
  const failed =
    actorId === null ||
    (readResult !== null && readResult.token === readToken && readResult.event === null);
  useEffect(() => {
    let active = true;
    if (actorId === null) return;
    const current = () =>
      active &&
      latestAttempt.current === attempt &&
      currentRead.current === readToken &&
      currentActor.current.actorId === actorId &&
      currentActor.current.isCurrent();
    void readCalendarEventAction(
      { v: 1, expectedActorId: actorId, activityId: id },
      readCsrfToken(),
    )
      .then((result) => {
        if (!current()) return;
        if (!result.ok || result.value.id !== id) {
          setReadResult({ token: readToken, event: null });
          return;
        }
        setReadResult({ token: readToken, event: result.value });
      })
      .catch(() => {
        if (current()) setReadResult({ token: readToken, event: null });
      });
    return () => {
      active = false;
    };
  }, [actorId, id, attempt, readToken]);
  if (snapshot !== null && snapshot.id === id && snapshot.canEdit === false)
    return <CalendarEventViewer event={snapshot} onClose={onClose} />;
  if (snapshot !== null && snapshot.id === id)
    return (
      <CalendarEventDialog
        key={`${actorId}:${id}`}
        editing={snapshot}
        onClose={onClose}
        onSaved={onSaved}
        onMarkedDone={onMarkedDone}
      />
    );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t("editor.edit")}</DialogTitle>
        </DialogHeader>
        {failed ? (
          <div className="space-y-4">
            <p role="alert">{t(actorId === null ? "editor.actorMissing" : "editor.loadFailed")}</p>
            <Button
              variant="outline"
              disabled={actorId === null}
              onClick={() => setAttempt((value) => value + 1)}
            >
              {t("editor.retry")}
            </Button>
          </div>
        ) : (
          <p role="status">{t("editor.loading")}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
