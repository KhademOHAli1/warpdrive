"use client";

import type React from "react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select, type SelectOption } from "@/components/ui/Select";
import { ACTIVITY_TYPE_ICON_KEYS, ActivityTypeIcon } from "@/features/activities/ActivityTypeIcon";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";
import { ActivityTypeItem } from "./ActivityTypeItem";
import type { ActivityTypeRow } from "./types";
import { useActivityTypeCatalog } from "./useActivityTypeCatalog";

export type { ActivityTypeRow } from "./types";

export function ActivityTypesClient({
  rows: initial,
}: {
  rows: ActivityTypeRow[];
}): React.ReactNode {
  const L = useSettingsMessages();
  const catalog = useActivityTypeCatalog(initial);
  const [addName, setAddName] = useState("");
  const [addIcon, setAddIcon] = useState(ACTIVITY_TYPE_ICON_KEYS[0] ?? "task");
  const icons: SelectOption[] = ACTIVITY_TYPE_ICON_KEYS.map((key) => ({
    value: key,
    label: (L._labels.icons as Record<string, string>)[key] ?? key,
    icon: <ActivityTypeIcon typeKey={key} />,
  }));

  async function add(): Promise<void> {
    const name = addName.trim();
    if (name !== "" && (await catalog.add(name, addIcon))) setAddName("");
  }

  return (
    <div className="space-y-4">
      <ul className="divide-y overflow-hidden rounded-lg border bg-card shadow-sm">
        {catalog.rows.map((row, index) => (
          <ActivityTypeItem
            key={row.id}
            row={row}
            first={index === 0}
            last={index === catalog.rows.length - 1}
            pending={catalog.pending}
            onRename={(name) => catalog.rename(row.id, name)}
            onToggle={() => void catalog.toggle(row)}
            onDelete={() => void catalog.remove(row.id)}
            onMove={(direction) => void catalog.move(index, direction)}
          />
        ))}
        {catalog.rows.length === 0 && (
          <li className="px-4 py-3 text-sm text-muted-foreground">{L.emptyList}</li>
        )}
      </ul>
      {catalog.error !== null && (
        <p role="alert" className="text-sm text-destructive">
          {catalog.error}
        </p>
      )}
      {(catalog.pending || catalog.saved) && (
        <p role="status" className="text-sm text-muted-foreground">
          {catalog.pending ? L._extra.saving : L.saved}
        </p>
      )}
      <div className="grid gap-3 rounded-lg border bg-card p-4 shadow-sm sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
        <label htmlFor="new-activity-type" className="block min-w-0">
          <span className="mb-1 block text-sm font-medium">{L.activityTypeName}</span>
          <Input
            id="new-activity-type"
            aria-label={L.activityTypeName}
            required
            maxLength={120}
            value={addName}
            disabled={catalog.pending}
            onChange={(event) => setAddName(event.target.value)}
          />
        </label>
        <div>
          <span className="mb-1 block text-sm font-medium">{L.iconLabel}</span>
          <Select
            ariaLabel={L.iconLabel}
            value={addIcon}
            onChange={setAddIcon}
            options={icons}
            disabled={catalog.pending}
          />
        </div>
        <Button
          size="sm"
          disabled={catalog.pending || addName.trim() === ""}
          onClick={() => void add()}
        >
          {L.addActivityType}
        </Button>
      </div>
    </div>
  );
}
