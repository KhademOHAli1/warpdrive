"use client";
import { useRouter } from "next/navigation";
import type React from "react";
import { useRef, useState } from "react";
import { useActionError } from "@/components/shell/ActionErrorProvider";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";
import {
  archiveLostReasonAction,
  createLostReasonAction,
  renameLostReasonAction,
  reorderLostReasonsAction,
} from "@/features/settings/lostReasonActions";
import { moveInArray } from "@/features/settings/reorder";
import { useSyncedState } from "@/lib/useSyncedState";
import { readCsrfToken } from "@/utils/csrfCookie";
import { ReorderControls } from "../ReorderControls";

export interface LostReasonRow {
  id: string;
  name: string;
}

const ROW_BUTTON = "min-h-10 text-xs font-medium text-muted-foreground";
type MutationResult = { ok: true } | { ok: false; error: { id: string } };

// Lost reasons tab (spec 6.3): archive is a soft-delete; historical deals keep their reason.
export function LostReasonsClient({ rows: initial }: { rows: LostReasonRow[] }): React.ReactNode {
  const L = useSettingsMessages();
  const S = L;

  const router = useRouter();
  const reportError = useActionError();
  // Re-seeds from refreshed server props: add/rename/archive call router.refresh(), which re-runs
  // the server component with fresh rows. Without this the list stays frozen until a hard reload
  // (SETTINGS-08). Re-seeding during render avoids the stale-then-correct double render an effect
  // would cause; `initial` comes from a server component, so its identity only changes on refresh.
  const [rows, setRows] = useSyncedState(initial);
  const [addName, setAddName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [pending, setPending] = useState(false);
  const busy = useRef(false);

  async function run(
    operation: () => Promise<MutationResult>,
    onSuccess: () => void,
  ): Promise<void> {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      const result = await operation();
      if (result.ok) {
        onSuccess();
        router.refresh();
      } else reportError(result.error.id);
    } catch {
      reportError();
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  async function add(): Promise<void> {
    const name = addName.trim();
    if (name === "") return;
    await run(
      () => createLostReasonAction({ name }, readCsrfToken()),
      () => setAddName(""),
    );
  }

  async function rename(id: string): Promise<void> {
    const name = editName.trim();
    if (name === "") return;
    await run(
      () => renameLostReasonAction({ id, name }, readCsrfToken()),
      () => {
        setRows((current) => current.map((row) => (row.id === id ? { ...row, name } : row)));
        setEditingId(null);
      },
    );
  }

  async function archive(id: string): Promise<void> {
    await run(
      () => archiveLostReasonAction({ id }, readCsrfToken()),
      () => {
        setRows((current) => current.filter((row) => row.id !== id));
      },
    );
  }

  async function move(index: number, dir: "up" | "down"): Promise<void> {
    if (busy.current) return;
    const previous = rows;
    const next = moveInArray(rows, index, dir);
    if (next[index]?.id === rows[index]?.id) return;
    busy.current = true;
    setPending(true);
    setRows(next);
    try {
      const r = await reorderLostReasonsAction(
        { orderedIds: next.map((r) => r.id) },
        readCsrfToken(),
      );
      if (!r.ok) {
        setRows(previous);
        reportError(r.error.id);
      }
    } catch {
      setRows(previous);
      reportError();
    } finally {
      busy.current = false;
      setPending(false);
      router.refresh();
    }
  }

  return (
    <div className="space-y-4" aria-busy={pending}>
      <ul className="divide-y overflow-hidden rounded-lg border bg-card shadow-sm">
        {rows.map((row, i) => (
          <li
            key={row.id}
            aria-label={row.name}
            className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center"
          >
            {editingId === row.id ? (
              <Input
                aria-label={S.lostReasonName}
                disabled={pending}
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="h-8 flex-1"
              />
            ) : (
              <span className="min-w-0 flex-1 break-words text-sm">
                <bdi dir="auto">{row.name}</bdi>
              </span>
            )}
            <div className="flex flex-wrap items-center gap-1">
              <ReorderControls
                canMoveUp={!pending && i > 0}
                canMoveDown={!pending && i < rows.length - 1}
                onMoveUp={() => void move(i, "up")}
                onMoveDown={() => void move(i, "down")}
              />
              {editingId === row.id ? (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={ROW_BUTTON}
                    disabled={pending}
                    onClick={() => void rename(row.id)}
                  >
                    {S.save}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={ROW_BUTTON}
                    disabled={pending}
                    onClick={() => {
                      setEditingId(null);
                      setEditName("");
                    }}
                  >
                    {S.cancel}
                  </Button>
                </>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className={ROW_BUTTON}
                  disabled={pending}
                  onClick={() => {
                    setEditingId(row.id);
                    setEditName(row.name);
                  }}
                >
                  {S.rename}
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className={ROW_BUTTON}
                disabled={pending}
                onClick={() => void archive(row.id)}
              >
                {S.archive}
              </Button>
            </div>
          </li>
        ))}
        {rows.length === 0 && (
          <li className="px-3 py-2 text-sm text-muted-foreground">{S.emptyList}</li>
        )}
      </ul>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4 shadow-sm">
        <label htmlFor="new-lost-reason" className="block flex-1">
          <span className="mb-1 block text-sm font-medium">{S.lostReasonName}</span>
          <Input
            id="new-lost-reason"
            aria-label={S.lostReasonName}
            required
            disabled={pending}
            maxLength={200}
            value={addName}
            onChange={(e) => setAddName(e.target.value)}
            className="w-full"
          />
        </label>
        <Button
          type="button"
          variant="default"
          size="sm"
          className="px-3"
          disabled={pending}
          onClick={() => void add()}
        >
          {S.addLostReason}
        </Button>
      </div>
    </div>
  );
}
