"use client";
import type React from "react";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import { SavedViewControl } from "@/features/saved-filters/SavedViewControl";
import type { SavedView } from "@/features/saved-filters/savedView";
import type { SavedViewPresentationCapture } from "@/features/saved-filters/viewPresentation";
import { ContactFilterBuilder } from "./ContactFilterBuilder";
import {
  type ContactFilterDefinition,
  ORG_FILTER_CONFIG,
  PERSON_FILTER_CONFIG,
} from "./contactFilterConfig";
import { orgFilterLabels, personFilterLabels } from "./contactFilterRows";

interface ContactDirectoryFiltersProps {
  entity: "person" | "organization";
  filter: ContactFilterDefinition | null;
  savedViewId: string | null;
  selectedView?: SavedView | null;
  selectionBlocked?: boolean;
  presentationCapture?: SavedViewPresentationCapture;
  onSelectView: (view: SavedView | null) => void;
  onApplyFilter: (def: ContactFilterDefinition | null) => void;
}

export function ContactDirectoryFilters({
  entity,
  filter,
  savedViewId,
  selectedView,
  selectionBlocked,
  presentationCapture,
  onSelectView,
  onApplyFilter,
}: ContactDirectoryFiltersProps): React.ReactNode {
  const tContacts = useAppTranslations("contacts");
  const locale = useLocale();
  const isPerson = entity === "person";

  return (
    <>
      <SavedViewControl
        targetEntity={entity}
        allLabel={tContacts(isPerson ? "allPeople" : "allOrganizations")}
        currentDefinition={filter}
        selectedViewId={savedViewId}
        selectedView={selectedView}
        selectionBlocked={selectionBlocked}
        presentationCapture={presentationCapture}
        onSelectView={onSelectView}
      />
      <ContactFilterBuilder
        config={isPerson ? PERSON_FILTER_CONFIG : ORG_FILTER_CONFIG}
        fieldLabels={isPerson ? personFilterLabels(locale) : orgFilterLabels(locale)}
        activeCount={filter?.conditions.length ?? 0}
        appliedDefinition={filter}
        onApply={onApplyFilter}
      />
    </>
  );
}
