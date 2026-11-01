"use client";
import { useRef, useState, useTransition } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/Button";
import type { Goal } from "@/db/schema/goals";
import { deleteGoalAction } from "@/features/goals/actions";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";
import { useFormatters } from "@/lib/useFormatters";
import { readCsrfToken } from "@/utils/csrfCookie";

interface Props {
  goals: Goal[];
  assigneeNames: Record<string, string>;
  onChanged: () => void;
  onEdit: (goal: Goal) => void;
}

export function GoalsTable({ goals, assigneeNames, onChanged, onEdit }: Props): React.ReactElement {
  const L = useSettingsMessages();
  const S = L;
  const format = useFormatters();
  function goalLabel(g: Goal): string {
    if (g.subject === "activity")
      return L._extra.activityGoalDisplayLabel(g.action, L._extra.goalIntervals[g.interval]);
    const noun = g.metric === "value" ? L._extra.goalDealValue : L._extra.deals;
    return L._extra.goalDisplayLabel(
      noun,
      L._extra.goalActions[g.action],
      L._extra.goalIntervals[g.interval],
    );
  }

  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const deleting = useRef(false);

  function confirmDelete(): void {
    const id = pendingDelete;
    if (id === null || deleting.current) return;
    deleting.current = true;
    setPendingDelete(null);
    setError(null);
    startTransition(async () => {
      // A dead session or a stale CSRF token fails here. Refreshing without saying so leaves
      // the row on screen with no explanation, which reads as the button being broken.
      try {
        const r = await deleteGoalAction(id, readCsrfToken());
        if (!r.ok) {
          setError(S.goalSaveFailed);
          return;
        }
        onChanged();
      } catch {
        setError(S.goalSaveFailed);
      } finally {
        deleting.current = false;
      }
    });
  }

  if (goals.length === 0) {
    return <p className="text-sm text-muted-foreground">{S.goalsEmpty}</p>;
  }

  return (
    <>
      {error !== null && (
        <p role="alert" className="mb-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <ul className="space-y-3" aria-busy={busy}>
        {goals.map((g) => (
          <li key={g.id} className="rounded-lg border bg-card p-4 text-sm shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="min-w-0 break-words font-medium">
                <bdi dir="auto">{goalLabel(g)}</bdi>
              </p>
              <span className="flex flex-wrap gap-1">
                <Button
                  variant="ghost"
                  className="min-h-10"
                  disabled={busy}
                  aria-label={`${S.goalEdit}: ${goalLabel(g)}`}
                  onClick={() => onEdit(g)}
                >
                  {S.goalEdit}
                </Button>
                <Button
                  variant="ghost"
                  className="min-h-10"
                  disabled={busy}
                  aria-label={`${S.goalDelete}: ${goalLabel(g)}`}
                  onClick={() => setPendingDelete(g.id)}
                >
                  {S.goalDelete}
                </Button>
              </span>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">{S.goalAssignee}</dt>
                <dd className="mt-1 break-words">
                  {g.assigneeId === null
                    ? L._extra.whole_company
                    : (assigneeNames[g.assigneeId] ??
                      (g.assigneeKind === "team" ? L._extra.unknownTeam : L._extra.unknownUser))}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{S.goalTarget}</dt>
                <dd className="mt-1 tabular-nums">
                  {format.number(Number(g.target), {
                    maximumFractionDigits: g.metric === "count" ? 0 : 4,
                  })}
                  {g.metric === "value" ? ` ${g.currency}` : ""}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{S.goalStartsOn}</dt>
                <dd className="mt-1 tabular-nums">{format.dateOnly(g.startsOn)}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title={S.goalDelete}
        description={S.goalDeleteConfirm}
        confirmLabel={S.goalDelete}
        destructive
        onConfirm={confirmDelete}
      />
    </>
  );
}
