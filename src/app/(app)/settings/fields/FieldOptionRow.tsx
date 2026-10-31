"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { archiveOptionAction, renameOptionAction } from "@/features/custom-fields/actions";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";
import type { CustomFieldOption } from "@/types/customFields";
import { readCsrfToken } from "@/utils/csrfCookie";
import { FieldTaskStatus, useFieldTask } from "./FieldTask";

export function FieldOptionRow({ defId, option }: { defId: string; option: CustomFieldOption }) {
  const S = useSettingsMessages();
  const router = useRouter();
  const task = useFieldTask();
  const [savedLabel, setSavedLabel] = useState(option.label);
  const [draft, setDraft] = useState(option.label);
  const dirty = draft !== savedLabel;

  async function save(): Promise<void> {
    if (!dirty || draft.trim() === "") return;
    await task.run(async () => {
      const result = await renameOptionAction(
        { id: defId, optionId: option.id, label: draft.trim() },
        readCsrfToken(),
      );
      if (result.ok) {
        setSavedLabel(draft.trim());
        setDraft(draft.trim());
        router.refresh();
      }
      return result;
    });
  }

  async function remove(): Promise<void> {
    await task.run(async () => {
      const result = await archiveOptionAction({ id: defId, optionId: option.id }, readCsrfToken());
      if (result.ok) router.refresh();
      return result;
    });
  }

  return (
    <li className="space-y-2" aria-busy={task.pending}>
      <div className="flex min-w-0 items-center gap-2">
        <Input
          aria-label={`${S.optionLabel}: ${option.label}`}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            task.reset();
          }}
          disabled={option.archived === true || task.pending}
          maxLength={255}
          className="min-w-0 flex-1"
        />
        {option.archived === true ? (
          <span className="text-xs text-muted-foreground">{S.optionArchived}</span>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => void remove()} disabled={task.pending}>
            {S.removeOption}
          </Button>
        )}
      </div>
      {dirty && option.archived !== true && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() => void save()}
            disabled={task.pending || draft.trim() === ""}
          >
            {S.save}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={task.pending}
            onClick={() => {
              setDraft(savedLabel);
              task.reset();
            }}
          >
            {S.cancel}
          </Button>
        </div>
      )}
      <FieldTaskStatus state={task.state} />
    </li>
  );
}
