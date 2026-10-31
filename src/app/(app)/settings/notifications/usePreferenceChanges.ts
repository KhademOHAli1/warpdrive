"use client";

import { useRef, useState } from "react";
import type { NotificationType } from "@/constants/notificationTypes";
import { setPreferenceAction } from "@/features/notifications/actions";
import type {
  NotificationPreference,
  PreferenceSaveFeedback,
} from "@/features/notifications/ui/PreferencesForm";
import { trpc } from "@/lib/trpc-client";
import { readCsrfToken } from "@/utils/csrfCookie";

type ByType<T> = Partial<Record<NotificationType, T>>;

function without<T>(current: ByType<T>, type: NotificationType): ByType<T> {
  const next = { ...current };
  delete next[type];
  return next;
}

export function usePreferenceChanges() {
  const utils = trpc.useUtils();
  const inFlight = useRef(new Set<NotificationType>());
  const [pending, setPending] = useState<ByType<NotificationPreference>>({});
  const [failed, setFailed] = useState<ByType<NotificationPreference>>({});
  const [feedback, setFeedback] = useState<ByType<PreferenceSaveFeedback>>({});

  async function save(type: NotificationType, next: NotificationPreference): Promise<void> {
    // A row sends both channels together. Lock it until confirmation so an older pair
    // cannot overwrite a newer choice, while unrelated notification events remain usable.
    if (inFlight.current.has(type)) return;
    inFlight.current.add(type);
    setPending((current) => ({ ...current, [type]: next }));
    setFeedback((current) => ({ ...current, [type]: "saving" }));
    setFailed((current) => without(current, type));

    try {
      await utils.notifications.preferences.cancel();
      const result = await setPreferenceAction({ type, ...next }, readCsrfToken());
      if (!result.ok) {
        setFailed((current) => ({ ...current, [type]: next }));
        setFeedback((current) => ({ ...current, [type]: "error" }));
        return;
      }
      utils.notifications.preferences.setData(undefined, (current) =>
        current === undefined ? current : { ...current, [type]: next },
      );
      setFeedback((current) => ({ ...current, [type]: "saved" }));
    } catch {
      setFailed((current) => ({ ...current, [type]: next }));
      setFeedback((current) => ({ ...current, [type]: "error" }));
    } finally {
      setPending((current) => without(current, type));
      inFlight.current.delete(type);
    }
  }

  function retry(type: NotificationType): void {
    const next = failed[type];
    if (next !== undefined) void save(type, next);
  }

  return { pending, feedback, save, retry };
}
