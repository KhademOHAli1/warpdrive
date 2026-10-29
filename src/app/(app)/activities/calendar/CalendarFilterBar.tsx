"use client";
import type React from "react";
import { Combobox, type ComboboxOption } from "@/components/ui/Combobox";
import { Select } from "@/components/ui/Select";
import type { ActivityTypeOption } from "@/features/activities/ActivitiesFilters";
import { ActivityTypeTab } from "@/features/activities/ActivityTypeTab";
import { activityTypeName } from "@/features/activities/activityTypeLabels";
import type { CalendarFilterState } from "@/features/activities/calendarFilter";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";

// Calendar filter toolbar (AC1): owner (assignee) / status / type, the same three axes the list
// toolbar offers, minus the date range (the calendar view is the date window). Reuses the shared
// Combobox / Select / ActivityTypeTab primitives.
export function CalendarFilterBar({
  filter,
  onChange,
  owners,
  types,
}: {
  filter: CalendarFilterState;
  onChange: (f: CalendarFilterState) => void;
  owners: ComboboxOption[];
  types: ActivityTypeOption[];
}): React.ReactNode {
  const t = useAppTranslations("calendar");
  const locale = useLocale();
  function patch(next: Partial<CalendarFilterState>): void {
    onChange({ ...filter, ...next });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {/* Both primitives default to w-full; with no width here each claims the whole flex line
            and wraps, so two one-word pickers render full-bleed and stacked. */}
        <Combobox
          ariaLabel={t("owner")}
          triggerClassName="w-52"
          value={filter.ownerId ?? ""}
          onChange={(v) => patch({ ownerId: v === "" ? null : v })}
          options={[{ value: "", label: t("allOwners") }, ...owners]}
        />
        <Select
          ariaLabel={t("status")}
          triggerClassName="w-52"
          value={filter.done}
          onChange={(v) => patch({ done: v as CalendarFilterState["done"] })}
          options={[
            { value: "open", label: t("open") },
            { value: "done", label: t("completed") },
            { value: "all", label: t("all") },
          ]}
        />
      </div>
      <div className="flex flex-wrap items-center gap-1 border-b pb-2">
        <ActivityTypeTab
          active={filter.typeKey}
          value={null}
          label={t("all")}
          onSelect={(tab) => patch({ typeKey: tab })}
        />
        {types.map((t) => (
          <ActivityTypeTab
            key={t.key}
            active={filter.typeKey}
            value={t.key}
            label={activityTypeName(t, locale)}
            icon
            onSelect={(tab) => patch({ typeKey: tab })}
          />
        ))}
      </div>
    </div>
  );
}
