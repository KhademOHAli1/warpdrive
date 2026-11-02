"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Switch } from "@/components/ui/Switch";
import { ActivityTypeIcon } from "@/features/activities/ActivityTypeIcon";
import { activityTypeName } from "@/features/activities/activityTypeLabels";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";
import { ReorderControls } from "../ReorderControls";
import type { ActivityTypeRow } from "./types";

export function ActivityTypeItem({
  row,
  first,
  last,
  pending,
  onRename,
  onToggle,
  onDelete,
  onMove,
}: {
  row: ActivityTypeRow;
  first: boolean;
  last: boolean;
  pending: boolean;
  onRename: (name: string) => Promise<boolean>;
  onToggle: () => void;
  onDelete: () => void;
  onMove: (direction: "up" | "down") => void;
}) {
  const L = useSettingsMessages();
  const name = activityTypeName(row, useLocale());
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(row.name);

  async function save(): Promise<void> {
    const next = draft.trim();
    if (next !== "" && (await onRename(next))) setEditing(false);
  }

  return (
    <li className="flex min-w-0 flex-col gap-3 px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <ActivityTypeIcon typeKey={row.icon ?? row.key} />
        {editing ? (
          <Input
            aria-label={`${L.activityTypeName}: ${name}`}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={pending}
            maxLength={120}
            className="min-w-0 flex-1"
          />
        ) : (
          <span
            className={`min-w-0 flex-1 break-words text-sm ${row.active ? "" : "text-muted-foreground line-through"}`}
          >
            {name}
          </span>
        )}
        {row.isSystem && (
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
            {L.systemBadge}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:ms-auto">
        <ReorderControls
          canMoveUp={!pending && !first}
          canMoveDown={!pending && !last}
          onMoveUp={() => onMove("up")}
          onMoveDown={() => onMove("down")}
        />
        {editing ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="min-h-10"
              disabled={pending || draft.trim() === "" || draft.trim() === row.name}
              onClick={() => void save()}
            >
              {L.save}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="min-h-10"
              disabled={pending}
              onClick={() => {
                setDraft(row.name);
                setEditing(false);
              }}
            >
              {L.cancel}
            </Button>
          </>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="min-h-10"
            disabled={pending}
            aria-label={`${L.rename}: ${name}`}
            onClick={() => {
              setDraft(row.name);
              setEditing(true);
            }}
          >
            {L.rename}
          </Button>
        )}
        <Switch
          checked={row.active}
          disabled={pending}
          onCheckedChange={onToggle}
          label={`${row.active ? L.disable : L.enable}: ${name}`}
        />
        {!row.isSystem && (
          <Button
            variant="ghost"
            size="sm"
            className="min-h-10"
            disabled={pending}
            aria-label={`${L.delete}: ${name}`}
            onClick={onDelete}
          >
            {L.delete}
          </Button>
        )}
      </div>
    </li>
  );
}
