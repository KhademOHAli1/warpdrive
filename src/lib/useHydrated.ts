"use client";

import { useSyncExternalStore } from "react";

const subscribe = (): (() => void) => () => {};
const clientSnapshot = (): boolean => true;
const serverSnapshot = (): boolean => false;

/** Returns false during server rendering and hydration, then true for client renders. */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
}
