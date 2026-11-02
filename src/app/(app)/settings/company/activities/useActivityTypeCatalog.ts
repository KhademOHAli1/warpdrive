"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useActionError } from "@/components/shell/ActionErrorProvider";
import { ERROR_IDS } from "@/constants/errorIds";
import {
  createActivityTypeAction,
  deleteActivityTypeAction,
  renameActivityTypeAction,
  reorderActivityTypesAction,
  setActivityTypeActiveAction,
  type TypeActionResult,
} from "@/features/activities/typeActions";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";
import { moveInArray } from "@/features/settings/reorder";
import { useSyncedState } from "@/lib/useSyncedState";
import { readCsrfToken } from "@/utils/csrfCookie";
import type { ActivityTypeRow } from "./types";

function slug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

type Change = { start?: () => void; commit?: () => void; rollback?: () => void };

export function useActivityTypeCatalog(initial: ActivityTypeRow[]) {
  const L = useSettingsMessages();
  const router = useRouter();
  const reportError = useActionError();
  const [rows, setRows] = useSyncedState(initial);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = useRef(false);

  async function run(task: () => Promise<TypeActionResult>, change: Change = {}): Promise<boolean> {
    // The catalog order and row state share one snapshot. Serialize writes so a rollback
    // cannot restore an order that predates another successful catalog change.
    if (locked.current) return false;
    locked.current = true;
    setPending(true);
    setSaved(false);
    setError(null);
    try {
      change.start?.();
      const result = await task();
      if (!result.ok) {
        change.rollback?.();
        if (result.error.id === ERROR_IDS.ACTIVITY_TYPE_IN_USE) setError(L.deleteTypeBlocked);
        else reportError(result.error.id);
        return false;
      }
      change.commit?.();
      setSaved(true);
      router.refresh();
      return true;
    } catch {
      change.rollback?.();
      reportError();
      return false;
    } finally {
      locked.current = false;
      setPending(false);
    }
  }

  function add(name: string, icon: string): Promise<boolean> {
    const key = slug(name).slice(0, 64) || `custom_${crypto.randomUUID().replaceAll("-", "")}`;
    return run(() => createActivityTypeAction({ name, icon, key }, readCsrfToken()));
  }

  function rename(id: string, name: string): Promise<boolean> {
    return run(() => renameActivityTypeAction({ id, name }, readCsrfToken()), {
      commit: () =>
        setRows((current) => current.map((row) => (row.id === id ? { ...row, name } : row))),
    });
  }

  function toggle(row: ActivityTypeRow): Promise<boolean> {
    const active = !row.active;
    return run(() => setActivityTypeActiveAction({ id: row.id, active }, readCsrfToken()), {
      commit: () =>
        setRows((current) =>
          current.map((item) => (item.id === row.id ? { ...item, active } : item)),
        ),
    });
  }

  function remove(id: string): Promise<boolean> {
    return run(() => deleteActivityTypeAction({ id }, readCsrfToken()), {
      commit: () => setRows((current) => current.filter((row) => row.id !== id)),
    });
  }

  function move(index: number, direction: "up" | "down"): Promise<boolean> {
    const previous = rows;
    const next = moveInArray(rows, index, direction);
    if (next[index]?.id === rows[index]?.id) return Promise.resolve(false);
    return run(
      () => reorderActivityTypesAction({ orderedIds: next.map((row) => row.id) }, readCsrfToken()),
      {
        start: () => setRows(next),
        rollback: () => setRows(previous),
      },
    );
  }

  return { rows, pending, saved, error, add, rename, toggle, remove, move };
}
