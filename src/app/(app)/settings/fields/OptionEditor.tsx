"use client";

import { useRouter } from "next/navigation";
import type React from "react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { addOptionAction } from "@/features/custom-fields/actions";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";
import type { CustomFieldOption } from "@/types/customFields";
import { readCsrfToken } from "@/utils/csrfCookie";
import { FieldOptionRow } from "./FieldOptionRow";
import { FieldTaskStatus, useFieldTask } from "./FieldTask";

export function OptionEditor({
  defId,
  options,
}: {
  defId: string;
  options: CustomFieldOption[];
}): React.ReactNode {
  const S = useSettingsMessages();
  const router = useRouter();
  const task = useFieldTask();
  const [newLabel, setNewLabel] = useState("");

  async function add(): Promise<void> {
    if (newLabel.trim() === "") return;
    await task.run(async () => {
      const result = await addOptionAction({ id: defId, label: newLabel.trim() }, readCsrfToken());
      if (result.ok) {
        setNewLabel("");
        router.refresh();
      }
      return result;
    });
  }

  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3">
      <ul className="space-y-3">
        {options.map((option) => (
          <FieldOptionRow key={`${option.id}:${option.label}`} defId={defId} option={option} />
        ))}
      </ul>
      <div className="flex min-w-0 flex-wrap items-end gap-2" aria-busy={task.pending}>
        <Input
          aria-label={S.newOption}
          value={newLabel}
          onChange={(event) => {
            setNewLabel(event.target.value);
            task.reset();
          }}
          disabled={task.pending}
          maxLength={255}
          placeholder={S.newOption}
          className="min-w-32 flex-1"
        />
        <Button
          type="button"
          size="sm"
          disabled={task.pending || newLabel.trim() === ""}
          onClick={() => void add()}
        >
          {S.addOption}
        </Button>
      </div>
      <FieldTaskStatus state={task.state} />
    </div>
  );
}
