"use client";
import { MoreHorizontal, Trash2 } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/Button";
import type { Goal } from "@/db/schema/goals";
import { deleteGoalAction } from "@/features/goals/actions";
import { useKpiHubMessages } from "@/features/goals/kpiHubMessages";
import type { KpiGoalResult } from "@/features/goals/kpiModel";
import { useKpiPresentation } from "@/features/goals/ui/useKpiPresentation";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";
import { useFormatters } from "@/lib/useFormatters";
import { readCsrfToken } from "@/utils/csrfCookie";

interface Props {
  goals: Goal[];
  customGoals?: KpiGoalResult[];
  onCustomOpen?: (row: KpiGoalResult) => void;
  pendingCustom?: boolean;
  customUnavailable?: boolean;
  assigneeNames: Record<string, string>;
  onChanged: () => void;
  onEdit: (goal: Goal) => void;
}

export function GoalsTable({
  goals,
  customGoals = [],
  onCustomOpen,
  pendingCustom = false,
  customUnavailable = false,
  assigneeNames,
  onChanged,
  onEdit,
}: Props): React.ReactElement {
  const L = useSettingsMessages();
  const S = L;
  const format = useFormatters();
  const K = useKpiHubMessages();
  const presentation = useKpiPresentation();
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
        try {
          onChanged();
        } catch {
          // A failed refresh does not undo the acknowledged goal deletion.
        }
      } catch {
        setError(S.goalSaveFailed);
      } finally {
        deleting.current = false;
      }
    });
  }

  if (goals.length === 0 && customGoals.length === 0) {
    if (customUnavailable) return <div className="border-t" />;
    if (pendingCustom)
      return (
        <p role="status" className="border-y py-6 text-center text-sm text-muted-foreground">
          {K.loading}
        </p>
      );
    return (
      <p className="border-y py-10 text-center text-sm text-muted-foreground">{S.goalsEmpty}</p>
    );
  }

  return (
    <>
      {error !== null && (
        <p role="alert" className="mb-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="overflow-x-auto border-y">
        <table className="w-full text-start text-sm" aria-busy={busy}>
          <caption className="sr-only">{K.goals}</caption>
          <thead className="border-b bg-muted/20 text-xs text-muted-foreground">
            <tr>
              {[K.name, K.scope, K.target, K.period, K.source].map((label) => (
                <th scope="col" key={label} className="px-3 py-2 text-start font-medium">
                  {label}
                </th>
              ))}
              <th scope="col" className="w-10">
                <span className="sr-only">{S.goalEdit}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {goals.map((g) => (
              <tr key={g.id} className="border-b last:border-b-0 hover:bg-muted/15">
                <td className="min-w-48 px-3 py-2.5">
                  <Button
                    variant="ghost"
                    type="button"
                    className="h-auto min-h-8 justify-start p-0 text-start font-medium hover:bg-transparent outline-none hover:text-link focus-visible:ring-2 focus-visible:ring-ring"
                    disabled={busy}
                    aria-label={`${S.goalEdit}: ${goalLabel(g)}`}
                    onClick={() => onEdit(g)}
                  >
                    <bdi dir="auto">{goalLabel(g)}</bdi>
                  </Button>
                </td>
                <td className="px-3 py-2.5 text-muted-foreground">
                  {g.assigneeId === null
                    ? L._extra.whole_company
                    : (assigneeNames[g.assigneeId] ??
                      (g.assigneeKind === "team" ? L._extra.unknownTeam : L._extra.unknownUser))}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">
                  {g.action === "lost" ? K.at_most : K.at_least}{" "}
                  <span>
                    {format.number(g.target, {
                      maximumFractionDigits: g.metric === "count" ? 0 : 4,
                    })}
                    {g.metric === "value" ? ` ${g.currency}` : ""}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">
                  {L._extra.goalIntervals[g.interval]}
                  <p className="mt-0.5 text-xs">
                    {format.dateOnly(g.startsOn)}
                    {g.endsOn !== null ? ` – ${format.dateOnly(g.endsOn)}` : ""}
                  </p>
                </td>
                <td className="px-3 py-2.5 text-xs text-muted-foreground">
                  {g.subject === "deal" ? K.deals : K.activities}
                </td>
                <td className="px-2 py-2.5">
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={busy}
                    aria-label={`${S.goalDelete}: ${goalLabel(g)}`}
                    onClick={() => setPendingDelete(g.id)}
                  >
                    <Trash2 aria-hidden className="size-3.5 text-muted-foreground" />
                  </Button>
                </td>
              </tr>
            ))}
            {customGoals.map((row) => (
              <tr key={row.goal.id} className="border-b last:border-b-0 hover:bg-muted/15">
                <td className="min-w-48 px-3 py-2.5">
                  <Button
                    variant="ghost"
                    type="button"
                    onClick={() => onCustomOpen?.(row)}
                    className="h-auto min-h-8 justify-start p-0 text-start font-medium hover:bg-transparent outline-none hover:text-link focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {row.goal.name !== undefined && row.goal.name !== "" ? row.goal.name : row.definition.name}
                  </Button>
                </td>
                <td className="px-3 py-2.5 text-muted-foreground">
                  {row.goal.scope === "company"
                    ? K.company
                    : (row.scopeName ?? assigneeNames[row.goal.scopeId ?? ""] ?? K[row.goal.scope])}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">
                  {presentation.condition(row.goal.condition, row.definition)}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">
                  {
                    K[
                      row.goal.period.kind === "calendar"
                        ? row.goal.period.interval
                        : row.goal.period.kind
                    ]
                  }
                  <p className="mt-0.5 text-xs">
                    {format.dateOnly(row.goal.period.startsOn)}
                    {row.goal.period.endsOn !== null && row.goal.period.endsOn !== undefined ? ` – ${format.dateOnly(row.goal.period.endsOn)}` : ""}
                  </p>
                </td>
                <td className="px-3 py-2.5 text-xs text-muted-foreground">
                  {row.definition.graph
                    ? K.customKpi
                    : row.definition.source === "manual"
                      ? K.manual
                      : K.crm}
                </td>
                <td className="px-2 py-2.5">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`${K.evidence}: ${row.goal.name !== undefined && row.goal.name !== "" ? row.goal.name : row.definition.name}`}
                    onClick={() => onCustomOpen?.(row)}
                  >
                    <MoreHorizontal aria-hidden className="size-4" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
