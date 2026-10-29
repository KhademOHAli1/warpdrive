"use client";

import { useEffect, useRef, useState } from "react";
import { readCsrfToken } from "@/utils/csrfCookie";
import { saveLocalePreferencesAction } from "./actions";
import type { LocalePreferences } from "./preferences";
import { directionForLocale } from "./registry";

function applyDirection(preferences: LocalePreferences): void {
  document.documentElement.lang = preferences.locale;
  document.documentElement.dir = directionForLocale(preferences.locale);
}

export function usePreferencePersistence(stored: LocalePreferences) {
  const [preferences, setPreferences] = useState(stored);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const current = useRef(stored);
  const lastSaved = useRef(stored);
  const latest = useRef(0);
  const saving = useRef(false);
  const inFlight = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    // An older action can re-render the server while a newer preference is queued.
    if (saving.current) return;
    current.current = stored;
    lastSaved.current = stored;
    // Server actions re-render this provider after cookie writes without remounting form state.
    setPreferences(stored);
    applyDirection(stored);
  }, [stored]);

  async function choose(patch: Partial<LocalePreferences>): Promise<boolean> {
    const next = { ...current.current, ...patch };
    const request = ++latest.current;
    saving.current = true;
    current.current = next;
    setPreferences(next);
    applyDirection(next);
    setPending(true);
    setError(false);
    // Serialize writes so a slower older save cannot overwrite a newer choice in the account.
    const done = inFlight.current.then(() => saveLocalePreferencesAction(next, readCsrfToken()));
    inFlight.current = done.catch(() => undefined);
    let saved = false;
    try {
      saved = (await done).ok;
    } catch {
      saved = false;
    }
    if (saved) lastSaved.current = next;
    if (request !== latest.current) return saved;
    saving.current = false;
    setPending(false);
    if (!saved) {
      const previous = lastSaved.current;
      current.current = previous;
      setPreferences(previous);
      applyDirection(previous);
      setError(true);
    }
    return saved;
  }

  return { preferences, pending, error, choose };
}
