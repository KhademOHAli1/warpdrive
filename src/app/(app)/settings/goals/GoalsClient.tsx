"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
      <GoalForm
        baseCurrency={baseCurrency}
        users={users}
        teams={teams}
        pipelines={pipelines}
        activityTypes={activityTypes}
        submitLabel={S.goalCreate}
        onSubmit={create}
        onDone={refresh}
      />
      <div className="mt-6">
        <GoalsTable
          goals={goals}
          assigneeNames={assigneeNames}
          onChanged={refresh}
          onEdit={setEditing}
        />
      </div>
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        <DialogContent className="max-w-3xl">
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
