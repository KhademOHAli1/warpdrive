"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { Goal } from "@/db/schema/goals";
import { createGoalAction, updateGoalAction } from "@/features/goals/actions";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";
import { readCsrfToken } from "@/utils/csrfCookie";
import { type GoalDraft, GoalForm, type Option } from "./GoalForm";
import { GoalsTable } from "./GoalsTable";

export function GoalsClient({
  goals,
  users,
  teams,
  pipelines,
  activityTypes,
  baseCurrency,
}: {
  goals: Goal[];
  users: Option[];
  teams: Option[];
  pipelines: Option[];
  activityTypes: Option[];
  baseCurrency?: string;
}): React.ReactElement {
  const L = useSettingsMessages();
  const S = L;

  const router = useRouter();
  const refresh = () => router.refresh();
  const [editing, setEditing] = useState<Goal | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const editReturnFocus = useRef<HTMLElement | null>(null);

  async function create(draft: GoalDraft) {
    const r = await createGoalAction(draft, readCsrfToken());
    return { ok: r.ok, errorId: r.ok ? undefined : r.error.id };
  }

  async function update(id: string, draft: GoalDraft) {
    const r = await updateGoalAction(id, draft, readCsrfToken());
    return { ok: r.ok, errorId: r.ok ? undefined : r.error.id };
  }
  // One lookup for both kinds: a goal's assignee is a user or a team, never both, so their ids
  // cannot collide in one map.
  const assigneeNames = Object.fromEntries(
    [...users, ...teams].map((o) => [o.id, o.name] as const),
  );

  return (
    <>
      <Dialog
        open={creating}
        onOpenChange={(open) => {
          if (!busy) setCreating(open);
        }}
      >
        <div className="flex justify-end">
          <DialogTrigger asChild>
            <Button>{S.goalNew}</Button>
          </DialogTrigger>
        </div>
        <DialogContent
          className="max-h-[90dvh] max-w-2xl overflow-y-auto"
          aria-describedby={undefined}
        >
          <DialogHeader>
            <DialogTitle>{S.goalNew}</DialogTitle>
          </DialogHeader>
          <GoalForm
            baseCurrency={baseCurrency}
            users={users}
            teams={teams}
            pipelines={pipelines}
            activityTypes={activityTypes}
            submitLabel={S.goalCreate}
            onSubmit={create}
            onBusyChange={setBusy}
            onCancel={() => setCreating(false)}
            onDone={() => {
              setCreating(false);
              refresh();
            }}
          />
        </DialogContent>
      </Dialog>
      <div className="mt-6">
        <GoalsTable
          goals={goals}
          assigneeNames={assigneeNames}
          onChanged={refresh}
          onEdit={(goal) => {
            editReturnFocus.current =
              document.activeElement instanceof HTMLElement ? document.activeElement : null;
            setEditing(goal);
          }}
        />
      </div>
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setEditing(null);
        }}
      >
        <DialogContent
          onCloseAutoFocus={(event) => {
            if (editReturnFocus.current?.isConnected === true) {
              event.preventDefault();
              editReturnFocus.current.focus();
            }
          }}
          className="max-h-[90dvh] max-w-2xl overflow-y-auto"
          aria-describedby={undefined}
        >
          <DialogHeader>
            <DialogTitle>{S.goalEdit}</DialogTitle>
          </DialogHeader>
          {editing !== null && (
            <GoalForm
              baseCurrency={baseCurrency}
              users={users}
              teams={teams}
              pipelines={pipelines}
              activityTypes={activityTypes}
              initial={editing}
              submitLabel={S.goalSave}
              onSubmit={(draft) => update(editing.id, draft)}
              onBusyChange={setBusy}
              onCancel={() => setEditing(null)}
              onDone={() => {
                setEditing(null);
                refresh();
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
