"use client";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { useActionError } from "@/components/shell/ActionErrorProvider";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { trpc } from "@/lib/trpc-client";
import { readCsrfToken } from "@/utils/csrfCookie";
import { SavedViewMenu } from "./SavedViewMenu";
import { SavedViewUnavailable } from "./SavedViewUnavailable";
import { SaveViewDialog } from "./SaveViewDialog";
import type { SavedView, SavedViewDefinition } from "./savedView";
import type { SavedFilterTargetEntity } from "./schemas";
import { removeSavedFilterAction, toggleFavoriteAction } from "./serverActions";
import { missingSavedView } from "./viewAvailability";
import type { SavedViewPresentationCapture } from "./viewPresentation";

const EMPTY_VIEW_DEFINITION: SavedViewDefinition = { combinator: "and", conditions: [] };

interface SavedViewControlProps {
  targetEntity: SavedFilterTargetEntity;
  // Copy for the row that clears the applied view, e.g. "All people".
  allLabel: string;
  // Conditions the list's filter builder currently has applied, offered as the body of a new view.
  currentDefinition: SavedViewDefinition | null;
  selectedViewId: string | null;
  selectedView?: SavedView | null;
  selectionBlocked?: boolean;
  presentationCapture?: SavedViewPresentationCapture;
  onSelectView: (view: SavedView | null) => void;
}

// The saved-view affordance for the People, Orgs and Leads toolbars: pick a view (or clear it),
// star one, or save what the filter builder has applied as a new view. One control for all three,
// entity-scoped by targetEntity.
export function SavedViewControl({
  targetEntity,
  allLabel,
  currentDefinition,
  selectedViewId,
  selectedView,
  selectionBlocked = false,
  presentationCapture,
  onSelectView,
}: SavedViewControlProps): React.ReactNode {
  const utils = trpc.useUtils();
  const reportError = useActionError();
  const compatibility = useAppTranslations("viewCompatibility");
  const query = trpc.savedFilters.listByTarget.useQuery({ targetEntity }, { staleTime: 10_000 });
  const [saving, setSaving] = useState(false);
  const views: SavedView[] = query.data ?? [];
  const resolved = query.data !== undefined && query.isFetching !== true && query.isStale !== true;
  const found = resolved ? views.find((view) => view.id === selectedViewId) : undefined;
  const missing: SavedView | null =
    selectedViewId === null || !resolved || found !== undefined
      ? null
      : missingSavedView(selectedViewId, selectedView?.name);
  const selected = found ?? missing ?? selectedView;
  const lastReported = useRef<string | null>(null);
  useEffect(() => {
    if (selectedViewId === null) lastReported.current = null;
    if (!resolved || selectedViewId === null || selected === undefined || selected === null) return;
    const key = JSON.stringify(selected);
    if (lastReported.current === key) return;
    const previousPresentation =
      selectedView?.availability === "unavailable" ? undefined : selectedView?.presentation;
    if (selected.availability === "unavailable") {
      if (currentDefinition === null && selectedView?.availability === "unavailable") return;
    } else if (
      JSON.stringify(selected.definition) === JSON.stringify(currentDefinition) &&
      JSON.stringify(selected.presentation) === JSON.stringify(previousPresentation)
    ) {
      lastReported.current = null;
      return;
    }
    lastReported.current = key;
    onSelectView(selected);
  }, [resolved, selectedViewId, selected, selectedView, currentDefinition, onSelectView]);
  const presentation = presentationCapture?.ok === true ? presentationCapture.value : undefined;
  const presentationError =
    presentationCapture !== undefined && !presentationCapture.ok ? presentationCapture.error : null;
  const presentationMessages = {
    "unsupported-column": compatibility("unsupportedColumns"),
    "unsupported-sort": compatibility("unsupportedSort"),
    "unsupported-scope": compatibility("unsupportedScope"),
  };
  const savable =
    selectionBlocked || selected?.availability === "unavailable" || presentationError !== null
      ? null
      : presentation !== undefined
        ? (currentDefinition ?? EMPTY_VIEW_DEFINITION)
        : currentDefinition !== null && currentDefinition.conditions.length > 0
          ? currentDefinition
          : null;

  async function toggleFav(id: string): Promise<void> {
    const r = await toggleFavoriteAction(id, readCsrfToken());
    if (!r.ok) reportError(r.error.id);
    // Invalidate either way: on failure the refetch reverts the star to its persisted state.
    await utils.savedFilters.listByTarget.invalidate({ targetEntity });
  }

  async function removeView(id: string): Promise<void> {
    const r = await removeSavedFilterAction(id, readCsrfToken());
    if (!r.ok) {
      reportError(r.error.id);
      return;
    }
    const refreshing = utils.savedFilters.listByTarget.invalidate({ targetEntity });
    if (selectedViewId === id) onSelectView(missingSavedView(id, selected?.name));
    await refreshing;
  }

  return (
    <>
      <SavedViewMenu
        views={views}
        selectedViewId={selectedViewId}
        allRecordsActive={
          !selectionBlocked && selectedViewId === null && currentDefinition === null
        }
        allLabel={allLabel}
        canSave={savable !== null}
        onSelect={onSelectView}
        onToggleFavorite={(id) => void toggleFav(id)}
        onDelete={(id) => void removeView(id)}
        onSaveCurrent={() => setSaving(true)}
      />
      {presentationError !== null && (
        <p role="alert" className="text-sm text-pretty text-muted-foreground">
          {presentationMessages[presentationError]}
        </p>
      )}
      {(selectionBlocked || selected?.availability === "unavailable") && (
        <SavedViewUnavailable
          missing={
            !selectionBlocked &&
            selected?.availability === "unavailable" &&
            selected.problem.kind === "missing"
          }
          name={selectionBlocked ? "" : (selected?.name ?? "")}
          onClear={() => onSelectView(null)}
        />
      )}
      {saving && savable !== null && (
        <SaveViewDialog
          targetEntity={targetEntity}
          definition={savable}
          presentation={presentation}
          onClose={() => setSaving(false)}
          onSaved={(view) => {
            void utils.savedFilters.listByTarget.invalidate({ targetEntity });
            onSelectView(view);
            setSaving(false);
          }}
        />
      )}
    </>
  );
}
