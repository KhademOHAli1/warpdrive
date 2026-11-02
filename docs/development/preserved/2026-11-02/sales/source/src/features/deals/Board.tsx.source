"use client";
import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  defaultKeyboardCoordinateGetter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { ERROR_IDS } from "@/constants/errorIds";
import {
  DealActionErrorProvider,
  useDealActionError,
} from "@/features/deal-workspace/DealActionErrorProvider";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { useLabelColorResolver } from "@/features/labels/useLabelColorResolver";
import { capture, currentRoute } from "@/features/observability/capture";
import { EVENTS } from "@/features/observability/events";
import { SavedViewPending } from "@/features/saved-filters/SavedViewPending";
import { SavedViewUnavailable } from "@/features/saved-filters/SavedViewUnavailable";
import type { FilterDefinition } from "@/features/saved-filters/schemas";
import { BoardEmpty } from "./BoardEmpty";
import { BoardHeader } from "./BoardHeader";
import { BoardStages } from "./BoardStages";
import { boardAnnouncements } from "./boardAnnouncements";
import { boardEmptyKind } from "./boardEmptyKind";
import type { BoardProps } from "./boardTypes";
import { isBoardFiltered } from "./boardView";
import { DealCard } from "./DealCard";
import { DragDropZones, zoneTransition } from "./DragDropZones";
import type { BoardCard } from "./dealRepo";
import { resolveNeighbors } from "./dragNeighbors";
import { MoveDealDialog } from "./MoveDealDialog";
import { NewDealButton } from "./NewDealButton";
import { useBoardDerived } from "./useBoardDerived";
import { useBoardPageQuery } from "./useBoardPageQuery";
import { useBoardRealtime } from "./useBoardRealtime";
import { useBoardView } from "./useBoardView";
import { useDealClose } from "./useDealClose";
import { useDealMove } from "./useDealMove";

export type { BoardProps } from "./boardTypes";

export function Board(props: BoardProps): React.ReactNode {
  return (
    <DealActionErrorProvider>
      <BoardContent {...props} />
    </DealActionErrorProvider>
  );
}

function BoardContent(props: BoardProps): React.ReactNode {
  const { locale } = useLocalePreferences();
  const { pipelineId, selfActorId, stages, cards, pipelines, density, baseCurrency } = props;
  const { serverNow } = props;
  const { move } = useDealMove(pipelineId);
  const reportError = useDealActionError();
  const { close } = useDealClose(pipelineId);
  useBoardRealtime(pipelineId, selfActorId);
  const resolveLabels = useLabelColorResolver("deal");
  // Toolbar view (owner filter, saved/ad-hoc filter, sort), seeded from the user's saved
  // preference and written back on every change.
  const view = useBoardView(props.initialView);
  const { ownerId: selectedOwnerId, savedFilter } = view;
  const { sortKey, sortDir: sortDirection } = view;
  // A not-yet-saved filter definition being previewed from the create-filter modal. When set it
  // overrides the saved filter for the board query, so the board shows the in-progress result
  // behind the modal; cleared (revert) when the modal closes. Transient by design: a preview
  // belongs to the open modal, so it is the one filter state that is never persisted.
  const [previewDefinition, setPreviewDefinition] = useState<FilterDefinition | null>(null);
  // Reveals the bottom action bar (Delete/Lost/Won/Move) only while a deal is being dragged.
  const [dragActive, setDragActive] = useState(false);
  // The drag-start card rendered lifted in the DragOverlay, retained across remote refreshes.
  const [activeCard, setActiveCard] = useState<BoardCard | undefined>(undefined);
  // Deal id awaiting a Move stage pick (set when a card is dropped on the Move zone).
  const [moveDealId, setMoveDealId] = useState<string | null>(null);

  const { viewUnavailable, viewPending, liveCards, refetch, queryError } = useBoardPageQuery({
    pipelineId,
    view,
    previewDefinition,
    cards,
    initialView: props.initialView,
  });

  // All display derivations (owner + saved-filter + quick-condition narrowing, per-stage sums,
  // board total, per-column sorting) live in one hook. Drag math still reads raw liveCards.
  const { owners, shownCards, sumsByStage, boardTotal, boardTotals, sortedByStage } =
    useBoardDerived({
      liveCards,
      baseCurrency,
      stages,
      selectedOwnerId,
      // Ad-hoc conditions now flow through the server-side filter definition (BoardFilterButton),
      // so there is no client-side quick-condition list to apply here.
      conditions: [],
      sortKey,
      sortDirection,
    });

  // Clock for time-derived visuals, seeded from the request so SSR and hydration agree on a real
  // timestamp. Reading `new Date()` during render would diverge between the two; starting from
  // null would make the first paint assert that nothing is scheduled and nothing is rotting.
  const [now, setNow] = useState<Date>(serverNow);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- hands the clock over to the browser after hydration so a long-lived tab does not keep reading the request time
  useEffect(() => setNow(new Date()), []);

  const cardTitleById = useMemo(() => new Map(liveCards.map((c) => [c.id, c.title])), [liveCards]);
  const stageNameById = useMemo(() => new Map(stages.map((s) => [s.id, s.name])), [stages]);
  // Event-only mirror keeps a drop bound to drag start even before React renders the overlay.
  const dragSnapshot = useRef<BoardCard | null>(null);
  const [moveVersion, setMoveVersion] = useState<string | undefined>(undefined);
  // One add-deal control, shared by the toolbar and the empty-pipeline state.
  const addDeal = (
    <NewDealButton pipelineId={pipelineId} pipelines={pipelines} baseCurrency={baseCurrency} />
  );
  // A filter that excluded every card is a different sentence from an empty pipeline, and only the
  // first one replaces the stage columns: an empty pipeline keeps them as the drop targets they are.
  const filtered = isBoardFiltered(view);
  const emptyKind = boardEmptyKind({
    shownCount: shownCards.length,
    liveCount: liveCards.length,
    filtered,
  });
  const sensors = useSensors(
    // Require an 8px drag before a pointer gesture becomes a drag, so a plain click on a
    // card fires its onClick (open the deal) instead of starting a drag (Pipedrive parity).
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: defaultKeyboardCoordinateGetter }),
  );

  // aria-live region ref: dnd-kit injects announcements into its own region, but
  // we keep a ref for any supplemental app-level announcements if needed.
  const liveRef = useRef<HTMLDivElement>(null);

  function onDragStart(e: DragStartEvent): void {
    const dealId = String(e.active.id);
    const snapshot = liveCards.find((card) => card.id === dealId);
    dragSnapshot.current = snapshot ?? null;
    setActiveCard(snapshot);
    const stageFrom = snapshot?.stageId ?? "";
    capture(EVENTS.boardDragStarted, { route: currentRoute(), stageFrom });
    setDragActive(true);
  }

  // Move a deal to the end of a stage column via the CAS move mutation.
  function moveToStage(dealId: string, toStageId: string, version: string | undefined): void {
    const destCards = liveCards.filter((c) => c.stageId === toStageId && c.id !== dealId);
    const { beforePosition, afterPosition } = resolveNeighbors(destCards, destCards.length);
    const expectedWriteVersion = version;
    if (expectedWriteVersion === undefined) {
      reportError(ERROR_IDS.DEAL_PRECONDITION);
      return;
    }
    move({ dealId, toStageId, beforePosition, afterPosition, expectedWriteVersion });
  }

  function onDragEnd(e: DragEndEvent): void {
    setDragActive(false);
    setActiveCard(undefined);
    const snapshot = dragSnapshot.current;
    dragSnapshot.current = null;
    const dealId = String(e.active.id);
    const toStageId = e.over !== null ? String(e.over.id) : null;
    const stageFrom = snapshot?.stageId ?? "";
    const stageTo = toStageId ?? "";
    capture(EVENTS.boardDragEnded, { route: currentRoute(), stageFrom, stageTo });
    if (toStageId === null) return;
    // Dropping onto a bottom action zone is not a stage move. Won/Lost close the deal; Move opens a
    // stage picker; Delete is not a drag target (deletion is a confirmed menu action).
    if (toStageId.startsWith("deal-zone-")) {
      if (toStageId === "deal-zone-move") {
        setMoveVersion(snapshot?.writeVersion);
        setMoveDealId(dealId);
        return;
      }
      const status = zoneTransition(toStageId, snapshot?.status);
      const zoneWriteVersion = snapshot?.writeVersion;
      if (status !== null && zoneWriteVersion !== undefined) {
        close({ dealId, status, expectedWriteVersion: zoneWriteVersion });
      }
      return;
    }

    moveToStage(dealId, toStageId, snapshot?.writeVersion);
  }

  return (
    // Full-height flex column so the stages list (and its lanes) fill the viewport height
    // instead of stopping at the cards' natural height.
    <div className="flex h-full flex-col">
      {/* Visually hidden aria-live region for supplemental board status messages (UI 9.1). */}
      <div ref={liveRef} aria-live="assertive" aria-atomic="true" className="sr-only" />

      <BoardHeader
        pipelineId={pipelineId}
        pipelines={pipelines}
        stages={stages}
        selfActorId={selfActorId}
        owners={owners}
        totalValue={String(boardTotal)}
        currencyTotals={boardTotals}
        dealCount={shownCards.length}
        currency={baseCurrency}
        view={view}
        addSlot={addDeal}
        onPreviewFilter={setPreviewDefinition}
        totalsUnavailable={viewUnavailable || viewPending}
        canManagePipelines={props.canManagePipelines}
      />

      {viewUnavailable ? (
        <SavedViewUnavailable
          missing={
            savedFilter?.availability === "unavailable" && savedFilter.problem.kind === "missing"
          }
          name={savedFilter?.name}
          onClear={view.clearFilters}
        />
      ) : viewPending ? (
        <SavedViewPending
          error={queryError}
          onRetry={() => {
            void refetch();
          }}
        />
      ) : (
        <DndContext
          // Stable, deterministic id so dnd-kit's accessibility ids (aria-describedby /
          // live-region) match between the server and client render. Without it dnd-kit
          // falls back to an internal counter that diverges under SSR and trips a React
          // hydration mismatch on the board.
          id={`board-${pipelineId}`}
          sensors={sensors}
          onDragStart={onDragStart}
          onDragCancel={() => {
            capture(EVENTS.boardDragCancelled, { route: currentRoute() });
            setDragActive(false);
            setActiveCard(undefined);
            dragSnapshot.current = null;
          }}
          onDragEnd={onDragEnd}
          accessibility={{
            announcements: boardAnnouncements(cardTitleById, stageNameById, locale),
          }}
        >
          {emptyKind !== "none" && (
            <BoardEmpty kind={emptyKind} onClearFilters={view.clearFilters} addSlot={addDeal} />
          )}
          {/* Only a board proven to be hiding cards drops its columns: the other two states may be
            an empty pipeline, whose columns are still the drop targets. */}
          {emptyKind !== "filtered" && (
            <BoardStages
              stages={stages}
              sumsByStage={sumsByStage}
              sortedByStage={sortedByStage}
              density={density}
              now={now}
              pipelineId={pipelineId}
              pipelines={pipelines}
              baseCurrency={baseCurrency}
            />
          )}

          {/* Bottom Delete/Lost/Won/Move action bar, revealed only during a drag (Pipedrive). */}
          <DragDropZones active={dragActive} />

          {/* Lifted card that follows the pointer while dragging (Pipedrive floats the card and
            leaves a dimmed placeholder in the column, which preserves the lane's layout). */}
          <DragOverlay>
            {activeCard !== undefined ? (
              <DealCard
                card={activeCard}
                currency={baseCurrency}
                ownerName={activeCard.ownerName ?? "?"}
                personName={activeCard.personName ?? null}
                orgName={activeCard.orgName ?? null}
                labels={resolveLabels(activeCard.labels)}
                rottingDays={null}
                density={density}
                now={now}
                elevated
              />
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {moveDealId !== null && (
        <MoveDealDialog
          stages={stages.map((s) => ({ id: s.id, name: s.name }))}
          onPick={(stageId) => {
            moveToStage(moveDealId, stageId, moveVersion);
            setMoveDealId(null);
          }}
          onClose={() => setMoveDealId(null)}
        />
      )}
    </div>
  );
}
