"use client";
import type React from "react";
import { Combobox, type ComboboxOption } from "@/components/ui/Combobox";
import { DatePicker } from "@/components/ui/DatePicker";
import { Select } from "@/components/ui/Select";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { ActivityPresetChips } from "./ActivityPresetChips";
import { ActivityTypeTab } from "./ActivityTypeTab";
import { activityTypeName } from "./activityTypeLabels";
import type { ActivityListFilter } from "./schemas";
import { useActivitiesMessages } from "./useActivitiesMessages";

export interface ActivityTypeOption {
  key: string;
  name: string;
}

interface ActivitiesFiltersProps {
  filter: ActivityListFilter;
  onChange: (f: ActivityListFilter) => void;
  owners: ComboboxOption[];
  types: ActivityTypeOption[];
}

// Activities-list filter toolbar (Pipedrive parity): owner, completed state, a custom date
// range, and the activity-type tab strip. Extracted from ActivitiesTable to keep it under the
// project's file-size budget. Every change here re-derives the full ActivityListFilter and hands
// it to onChange, so the table (which owns the state and feeds it straight to listRows) re-queries
// server-side; there is no client-side re-filtering here or in the table.
export function ActivitiesFilters({
  filter,
  onChange,
  owners,
  types,
}: ActivitiesFiltersProps): React.ReactNode {
  const S = useActivitiesMessages();
  const locale = useLocale();
  function patch(next: Partial<ActivityListFilter>): void {
    onChange({ ...filter, ...next });
  }

  function selectType(tab: string | null): void {
    patch({ typeKey: tab });
  }

  return (
    <div className="flex flex-col gap-2">
      <ActivityPresetChips from={filter.from} to={filter.to} onApply={(range) => patch(range)} />
      <div className="flex flex-wrap items-center gap-2">
        {/* Both primitives default to w-full; with no width here each claims the whole flex line
            and wraps, so the pickers render full-bleed and stacked. */}
        <Combobox
          ariaLabel={S.owner}
          triggerClassName="w-52"
          value={filter.ownerId ?? ""}
          onChange={(v) => patch({ ownerId: v === "" ? null : v })}
          options={[{ value: "", label: S.allOwners }, ...owners]}
        />
        <Select
          ariaLabel={S.status}
          triggerClassName="w-52"
          value={filter.done}
          onChange={(v) => patch({ done: v as ActivityListFilter["done"] })}
          options={[
            { value: "open", label: S.openStatus },
            { value: "done", label: S.completed },
            { value: "all", label: S.all },
          ]}
        />
        <DatePicker
          ariaLabel={S.from}
          value={filter.from}
          onChange={(v) => patch({ from: v })}
          placeholder={S.from}
        />
        <DatePicker
          ariaLabel={S.to}
          value={filter.to}
          onChange={(v) => patch({ to: v })}
          placeholder={S.to}
        />
      </div>
      <div className="flex flex-wrap items-center gap-1 border-b pb-2">
        <ActivityTypeTab active={filter.typeKey} value={null} label={S.all} onSelect={selectType} />
        {types.map((t) => (
          <ActivityTypeTab
            key={t.key}
            active={filter.typeKey}
            value={t.key}
            label={activityTypeName(t, locale)}
            icon
            onSelect={selectType}
          />
        ))}
      </div>
    </div>
  );
}
