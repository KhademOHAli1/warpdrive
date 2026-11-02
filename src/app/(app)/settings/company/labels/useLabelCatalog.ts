"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useActionError } from "@/components/shell/ActionErrorProvider";
import { ERROR_IDS } from "@/constants/errorIds";
import type { LabelColor, LabelTarget } from "@/constants/labelColors";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";
import {
  createLabelAction,
  deleteLabelAction,
  type LabelActionResult,
  renameLabelAction,
  reorderLabelsAction,
  setLabelColorAction,
} from "@/features/labels/actions";
import { moveInArray } from "@/features/settings/reorder";
import { useSyncedState } from "@/lib/useSyncedState";
import { readCsrfToken } from "@/utils/csrfCookie";
import type { LabelRowData } from "./LabelRow";

export interface LabelCatalogRow extends LabelRowData {
  target: LabelTarget;
}
type Change = { start?: () => void; commit?: () => void; rollback?: () => void };

export function useLabelCatalog(initial: LabelCatalogRow[]) {
  const L = useSettingsMessages();
  const router = useRouter();
  const reportError = useActionError();
  const [rows, setRows] = useSyncedState(initial);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = useRef(false);

  async function run(
    task: () => Promise<LabelActionResult>,
    change: Change = {},
  ): Promise<boolean> {
    // A single catalog writer keeps optimistic order rollback from erasing another row edit.
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
        if (result.error.id === ERROR_IDS.LABEL_IN_USE) setError(L.deleteLabelBlocked);
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

  function add(target: LabelTarget, name: string, color: LabelColor): Promise<boolean> {
    return run(() => createLabelAction({ target, name, color }, readCsrfToken()));
  }

  function rename(id: string, name: string): Promise<boolean> {
    return run(() => renameLabelAction({ id, name }, readCsrfToken()), {
      commit: () =>
        setRows((current) => current.map((row) => (row.id === id ? { ...row, name } : row))),
    });
  }

  function color(id: string, color: LabelColor): Promise<boolean> {
    return run(() => setLabelColorAction({ id, color }, readCsrfToken()), {
      commit: () =>
        setRows((current) => current.map((row) => (row.id === id ? { ...row, color } : row))),
    });
  }

  function remove(id: string): Promise<boolean> {
    return run(() => deleteLabelAction({ id }, readCsrfToken()), {
      commit: () => setRows((current) => current.filter((row) => row.id !== id)),
    });
  }

  function move(
    target: LabelTarget,
    groupIds: string[],
    index: number,
    direction: "up" | "down",
  ): Promise<boolean> {
    const previous = rows;
    const ids = moveInArray(groupIds, index, direction);
    if (ids[index] === groupIds[index]) return Promise.resolve(false);
    const byId = new Map(rows.map((row) => [row.id, row]));
    const reordered = ids
      .map((id) => byId.get(id))
      .filter((row): row is LabelCatalogRow => row !== undefined);
    const next = [...rows.filter((row) => row.target !== target), ...reordered];
    return run(() => reorderLabelsAction({ orderedIds: ids }, readCsrfToken()), {
      start: () => setRows(next),
      rollback: () => setRows(previous),
    });
  }

  return { rows, pending, saved, error, add, rename, color, remove, move };
}
