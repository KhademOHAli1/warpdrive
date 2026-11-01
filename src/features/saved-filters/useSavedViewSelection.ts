"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ColumnSort } from "@/components/data-table/useColumnSort";
import { setSavedViewSelectionAction } from "@/features/identity/preferencesActions";
import { readCsrfToken } from "@/utils/csrfCookie";
import type { SavedView, SavedViewDefinition } from "./savedView";
import type { SavedViewSelectionSeed } from "./savedViewSelection";
import type { SavedViewPresentationTarget } from "./viewPresentation";

export interface NativeViewSnapshot<F extends string> {
  columns: readonly string[];
  sort: ColumnSort<F> | null;
}
type Persistence = "idle" | "pending" | "failed";
type SelectionState = {
  mode: "personal" | "view";
  selectedView: SavedView | null;
  definition: SavedViewDefinition | null;
  selectionBlocked: boolean;
};
// Keep ordering across component remounts and rapid events for one native actor and entity.
const queues = new Map<string, Promise<void>>();

function presentation<F extends string>(
  view: SavedView | null,
  baseline: NativeViewSnapshot<F>,
): NativeViewSnapshot<F> {
  if (view === null || view.availability === "unavailable" || view.presentation === undefined)
    return baseline;
  // The native entity-scoped decoder validated these fields before creating the available DTO.
  return { columns: view.presentation.columns, sort: view.presentation.sort as ColumnSort<F> };
}

export function useSavedViewSelection<F extends string>(
  targetEntity: SavedViewPresentationTarget,
  baseline: NativeViewSnapshot<F>,
  seed: Partial<SavedViewSelectionSeed> & { preferenceActorId?: string } = {},
) {
  const initialView = seed.initialSavedView ?? null;
  const baselineRef = useRef(baseline);
  const [initialPresentation] = useState(() => presentation(initialView, baseline));
  const [state, setState] = useState<SelectionState>(() => ({
    mode: initialView !== null || seed.initialSelectionBlocked === true ? "view" : "personal",
    selectedView: initialView,
    definition: initialView?.definition ?? null,
    selectionBlocked: seed.initialSelectionBlocked === true,
  }));
  const stateRef = useRef(state);
  const [persistence, setPersistence] = useState<Persistence>("idle");
  const latestWrite = useRef(0);
  const principalRef = useRef(seed.preferenceActorId);
  useLayoutEffect(() => {
    principalRef.current = seed.preferenceActorId;
  }, [seed.preferenceActorId]);
  const localQueue = useRef<Promise<void>>(Promise.resolve());
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  function update(next: SelectionState): void {
    stateRef.current = next;
    setState(next);
  }
  function persist(savedViewId: string | null): void {
    const write = ++latestWrite.current;
    const expectedActorId = principalRef.current;
    const csrfToken = readCsrfToken();
    const queueKey = expectedActorId === undefined ? null : `${expectedActorId}:${targetEntity}`;
    setPersistence("pending");
    const previous =
      queueKey === null ? localQueue.current : (queues.get(queueKey) ?? Promise.resolve());
    const task = previous.then(async () => {
      if (
        principalRef.current !== expectedActorId ||
        (expectedActorId === undefined && !alive.current)
      )
        return;
      let success = false;
      try {
        const input = { targetEntity, savedViewId };
        const result =
          expectedActorId === undefined
            ? await setSavedViewSelectionAction(input, csrfToken)
            : await setSavedViewSelectionAction(input, csrfToken, expectedActorId);
        success = result.ok;
      } catch {
        // Transport failures use the same retryable UI state as a Result failure.
      }
      if (
        alive.current &&
        principalRef.current === expectedActorId &&
        latestWrite.current === write
      )
        setPersistence(success ? "idle" : "failed");
    });
    if (queueKey === null) localQueue.current = task;
    else queues.set(queueKey, task);
  }
  function select(view: SavedView | null, current: NativeViewSnapshot<F>): NativeViewSnapshot<F> {
    if (view === null) {
      if (stateRef.current.mode === "personal")
        baselineRef.current = { columns: [...current.columns], sort: current.sort };
      update({ mode: "personal", selectedView: null, definition: null, selectionBlocked: false });
      persist(null);
      return baselineRef.current;
    }
    if (stateRef.current.mode === "personal")
      baselineRef.current = { columns: [...current.columns], sort: current.sort };
    update({
      mode: "view",
      selectedView: view,
      definition: view.definition,
      selectionBlocked: false,
    });
    persist(view.id);
    return presentation(view, baselineRef.current);
  }
  function detach(): void {
    const current = stateRef.current;
    if (current.selectedView === null && !current.selectionBlocked) return;
    update({ ...current, selectedView: null, selectionBlocked: false });
    persist(null);
  }
  function editDefinition(definition: SavedViewDefinition | null): void {
    detach();
    update({ ...stateRef.current, definition });
  }

  return {
    ...state,
    initialPresentation,
    blocked: state.selectionBlocked || state.selectedView?.availability === "unavailable",
    persistence,
    select,
    detach,
    editDefinition,
  };
}
