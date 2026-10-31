"use client";
import { useRouter } from "next/navigation";
import type React from "react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/Collapsible";
import { Input } from "@/components/ui/Input";
import { Switch } from "@/components/ui/Switch";
import {
  archiveDefAction,
  renameDefAction,
  setDefFlagsAction,
} from "@/features/custom-fields/actions";
import { settingsFieldType } from "@/features/identity/settingsMessages";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";
import { readCsrfToken } from "@/utils/csrfCookie";
import { ReorderControls } from "../company/ReorderControls";
import { FieldTaskStatus, useFieldTask } from "./FieldTask";
import { OptionEditor } from "./OptionEditor";
import type { FieldRow } from "./types";

const OPTION_TYPES = new Set(["single_option", "multi_option"]);
const ROW_ACTION =
  "relative min-h-10 px-1 text-xs font-medium text-muted-foreground transition-colors duration-150 ease-out after:absolute after:inset-x-0 after:inset-y-0 after:content-[''] hover:text-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 motion-reduce:transition-none";

export function FieldRowItem({
  row,
  isFirst,
  isLast,
  onMove,
}: {
  row: FieldRow;
  isFirst: boolean;
  isLast: boolean;
  onMove: (direction: "up" | "down") => void;
}): React.ReactNode {
  const L = useSettingsMessages();
  const S = L;

  const router = useRouter();
  const task = useFieldTask();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(row.name);
  const [showOptions, setShowOptions] = useState(false);
  const isOptionType = OPTION_TYPES.has(row.type);

  const activeOptions = row.options.filter((o) => o.archived !== true);

  async function saveName(): Promise<void> {
    const trimmed = draft.trim();
    if (trimmed === "" || trimmed === row.name) {
      setEditing(false);
      return;
    }
    await task.run(async () => {
      const r = await renameDefAction({ id: row.id, name: trimmed }, readCsrfToken());
      if (r.ok) {
        setEditing(false);
        router.refresh();
      }
      return r;
    });
  }

  async function archive(): Promise<void> {
    await task.run(async () => {
      const r = await archiveDefAction({ id: row.id }, readCsrfToken());
      if (r.ok) router.refresh();
      return r;
    });
  }

  // Always sends the full { isImportant, showInAddForm } pair so toggling one flag can never
  // clobber the other with a stale default.
  async function setFlags(next: { isImportant: boolean; showInAddForm: boolean }): Promise<void> {
    await task.run(async () => {
      const r = await setDefFlagsAction({ id: row.id, ...next }, readCsrfToken());
      if (r.ok) router.refresh();
      return r;
    });
  }

  return (
    <Collapsible open={showOptions} onOpenChange={setShowOptions} asChild>
      <li
        aria-busy={task.pending}
        className="space-y-3 px-3 py-3 transition-colors duration-150 ease-out hover:bg-accent/30 motion-reduce:transition-none"
      >
        <div className="min-w-0">
          {editing ? (
            <Input
              aria-label={S.rename}
              value={draft}
              disabled={task.pending}
              onChange={(e) => {
                setDraft(e.target.value);
                task.reset();
              }}
              className="flex-1"
            />
          ) : (
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="break-words text-sm font-medium [overflow-wrap:anywhere]">
                  {row.name}
                </span>
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] capitalize text-muted-foreground">
                  {settingsFieldType(L, row.type)}
                </span>
              </div>
              {activeOptions.length > 0 && (
                <p className="mt-0.5 break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">
                  {activeOptions.map((o) => o.label).join(", ")}
                </p>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-2">
          <ReorderControls
            canMoveUp={!isFirst && !task.pending}
            canMoveDown={!isLast && !task.pending}
            onMoveUp={() => onMove("up")}
            onMoveDown={() => onMove("down")}
          />
          {editing ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void saveName()}
                disabled={task.pending || draft.trim() === "" || draft.trim() === row.name}
                className={ROW_ACTION}
              >
                {S.save}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={task.pending}
                onClick={() => {
                  setDraft(row.name);
                  setEditing(false);
                  task.reset();
                }}
                className={ROW_ACTION}
              >
                {S.cancel}
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              disabled={task.pending}
              onClick={() => {
                setDraft(row.name);
                setEditing(true);
                task.reset();
              }}
              className={ROW_ACTION}
            >
              {S.rename}
            </Button>
          )}
          {isOptionType && (
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className={ROW_ACTION} disabled={task.pending}>
                {S.editOptions}
              </Button>
            </CollapsibleTrigger>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void archive()}
            className={ROW_ACTION}
            disabled={task.pending}
          >
            {S.archive}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <span className="flex items-center gap-1.5">
            <Switch
              checked={row.isImportant}
              onCheckedChange={(v) =>
                void setFlags({ isImportant: v, showInAddForm: row.showInAddForm })
              }
              label={`${S.important}: ${row.name}`}
              disabled={task.pending}
            />
            <span className="text-xs text-muted-foreground">{S.important}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <Switch
              checked={row.showInAddForm}
              onCheckedChange={(v) =>
                void setFlags({ isImportant: row.isImportant, showInAddForm: v })
              }
              label={`${S.showInAddForm}: ${row.name}`}
              disabled={task.pending}
            />
            <span className="text-xs text-muted-foreground">{S.showInAddForm}</span>
          </span>
        </div>
        <FieldTaskStatus state={task.state} />
        {isOptionType ? (
          <CollapsibleContent>
            <OptionEditor defId={row.id} options={row.options} />
          </CollapsibleContent>
        ) : null}
      </li>
    </Collapsible>
  );
}
