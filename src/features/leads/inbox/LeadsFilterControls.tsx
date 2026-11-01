"use client";
import type React from "react";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { SavedViewControl } from "@/features/saved-filters/SavedViewControl";
import type { SavedView } from "@/features/saved-filters/savedView";
import type { LeadConditionInput } from "../schemas";
import { LeadFilterBuilder } from "./LeadFilterBuilder";

interface LeadsFilterControlsProps {
  // Assignable users, offered as the value dropdown for an Owner condition.
  users: ReadonlyArray<{ id: string; name: string }>;
  condition: LeadConditionInput | null;
  selectedView: SavedView | null;
  onSelectView: (view: SavedView | null) => void;
  onCondition: (condition: LeadConditionInput | null) => void;
}

// The Leads Inbox filter pair: the saved-view picker and the ad-hoc condition builder. Which view
// is applied also controls read admission in the parent inbox.
export function LeadsFilterControls({
  users,
  condition,
  selectedView,
  onSelectView,
  onCondition,
}: LeadsFilterControlsProps): React.ReactNode {
  const tLeads = useAppTranslations("leads");

  return (
    <>
      <SavedViewControl
        targetEntity="lead"
        allLabel={tLeads("allLeads")}
        currentDefinition={condition}
        selectedViewId={selectedView?.id ?? null}
        selectedView={selectedView}
        onSelectView={onSelectView}
      />
      <LeadFilterBuilder
        users={users}
        activeCount={condition?.conditions.length ?? 0}
        appliedCondition={condition}
        onApply={(next) => {
          // An ad-hoc edit is no longer the saved view, so the picker stops claiming it is.
          onSelectView(null);
          onCondition(next);
        }}
      />
    </>
  );
}
