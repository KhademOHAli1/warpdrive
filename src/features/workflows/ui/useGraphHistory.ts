"use client";

import { type SetStateAction, useCallback, useReducer } from "react";
import type { WorkflowDefinition } from "../schemas";

type History = {
  past: WorkflowDefinition[];
  present: WorkflowDefinition;
  future: WorkflowDefinition[];
};
type Action =
  | { type: "edit"; value: SetStateAction<WorkflowDefinition> }
  | { type: "adopt"; value: WorkflowDefinition }
  | { type: "undo" | "redo" };

function reduce(state: History, action: Action): History {
  if (action.type === "adopt") return { ...state, present: action.value };
  if (action.type === "edit") {
    const next = typeof action.value === "function" ? action.value(state.present) : action.value;
    if (JSON.stringify(next) === JSON.stringify(state.present)) return state;
    return { past: [...state.past, state.present].slice(-50), present: next, future: [] };
  }
  if (action.type === "undo") {
    const previous = state.past.at(-1);
    return previous === undefined
      ? state
      : {
          past: state.past.slice(0, -1),
          present: previous,
          future: [state.present, ...state.future],
        };
  }
  const next = state.future[0];
  return next === undefined
    ? state
    : { past: [...state.past, state.present], present: next, future: state.future.slice(1) };
}

export function useGraphHistory(initial: WorkflowDefinition) {
  const [state, dispatch] = useReducer(reduce, { past: [], present: initial, future: [] });
  return {
    definition: state.present,
    setDefinition: useCallback(
      (value: SetStateAction<WorkflowDefinition>) => dispatch({ type: "edit", value }),
      [],
    ),
    adopt: useCallback((value: WorkflowDefinition) => dispatch({ type: "adopt", value }), []),
    undo: useCallback(() => dispatch({ type: "undo" }), []),
    redo: useCallback(() => dispatch({ type: "redo" }), []),
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  };
}
