"use client";
import { useRouter } from "next/navigation";
import type React from "react";
import { Switch } from "@/components/ui/Switch";
import type { CustomFieldTarget } from "@/constants/customFieldTypes";
import { setBuiltinFieldHiddenAction } from "@/features/custom-fields/actions";
import { settingsBuiltinLabel } from "@/features/identity/settingsMessages";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";
import { readCsrfToken } from "@/utils/csrfCookie";
import { FieldTaskStatus, useFieldTask } from "./FieldTask";
import type { BuiltinRow } from "./types";

// One built-in field in the Data fields list. Locked identity fields render as a labelled,
// badge-only row (no toggle). Everything else gets a single Hidden switch wired to the gated
// action; a failure surfaces through the shared error reporter (never silent).
export function BuiltinFieldRow({
  entity,
  row,
}: {
  entity: CustomFieldTarget;
  row: BuiltinRow;
}): React.ReactNode {
  const L = useSettingsMessages();
  const S = L;
  const label = settingsBuiltinLabel(L, row.label);

  const router = useRouter();
  const task = useFieldTask();

  async function toggle(next: boolean): Promise<void> {
    await task.run(async () => {
      const r = await setBuiltinFieldHiddenAction(
        { entity, key: row.key, hidden: next },
        readCsrfToken(),
      );
      if (r.ok) router.refresh();
      return r;
    });
  }

  return (
    <li
      aria-busy={task.pending}
      className="flex min-h-10 flex-wrap items-center gap-2 px-3 py-3 text-sm transition-colors duration-150 ease-out hover:bg-accent/30 motion-reduce:transition-none"
    >
      <span className="min-w-0 flex-1 break-words font-medium [overflow-wrap:anywhere]">
        {label}
      </span>
      <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
        {S.builtinBadge}
      </span>
      <span className="ms-auto flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
        {row.locked ? (
          <span>{S.builtinAlwaysShown}</span>
        ) : (
          <>
            <span>{S.builtinHidden}</span>
            <Switch
              checked={row.hidden}
              onCheckedChange={(next) => void toggle(next)}
              label={`${S.builtinHidden}: ${label}`}
              disabled={task.pending}
            />
          </>
        )}
      </span>
      <FieldTaskStatus state={task.state} />
    </li>
  );
}
