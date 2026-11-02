"use client";
import type React from "react";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import { SavedViewControl } from "@/features/saved-filters/SavedViewControl";
import type { SavedView } from "@/features/saved-filters/savedView";
import type { SavedViewPresentationCapture } from "@/features/saved-filters/viewPresentation";
import { ContactFilterBuilder } from "./ContactFilterBuilder";
import { type ContactFilterDefinition, ORG_FILTER_CONFIG } from "./contactFilterConfig";
import { orgFilterLabels } from "./contactFilterRows";

export interface OrgsListToolbarProps {
  filter: ContactFilterDefinition | null;
  savedViewId: string | null;
  selectedView?: SavedView | null;
  selectionBlocked?: boolean;
  presentationCapture?: SavedViewPresentationCapture;
  onSelectView: (view: SavedView | null) => void;
  onApplyFilter: (def: ContactFilterDefinition | null) => void;
}

export function OrgsListToolbar({
  filter,
  savedViewId,
  selectedView,
  selectionBlocked,
  presentationCapture,
  onSelectView,
  onApplyFilter,
}: OrgsListToolbarProps): React.ReactNode {
  const tContacts = useAppTranslations("contacts");
  const locale = useLocale();

  return (
    <div className="flex items-center gap-2">
      <SavedViewControl
        targetEntity="organization"
        allLabel={tContacts("allOrganizations")}
        currentDefinition={filter}
        selectedViewId={savedViewId}
        selectedView={selectedView}
        selectionBlocked={selectionBlocked}
        presentationCapture={presentationCapture}
        onSelectView={onSelectView}
      />
      <ContactFilterBuilder
        config={ORG_FILTER_CONFIG}
        fieldLabels={orgFilterLabels(locale)}
        activeCount={filter?.conditions.length ?? 0}
        appliedDefinition={filter}
        onApply={onApplyFilter}
      />
    </div>
  );
}
