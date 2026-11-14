"use client";

import { createContext, type ReactNode, useContext } from "react";
import { useHydrated } from "@/lib/useHydrated";

export type DealDetailInitialFormats = {
  summaryValue: string;
  headerValue: string | null;
  expectedCloseDate: string | null;
  createdDate: string;
};

const InitialFormats = createContext<DealDetailInitialFormats | null>(null);

export function DealDetailInitialFormatsProvider({
  initial,
  children,
}: {
  initial: DealDetailInitialFormats;
  children: ReactNode;
}) {
  return <InitialFormats.Provider value={initial}>{children}</InitialFormats.Provider>;
}

export function useDealDetailInitialFormats(): DealDetailInitialFormats | null {
  const initial = useContext(InitialFormats);
  const hydrated = useHydrated();
  // The server and browser can use different ICU data for the same locale.
  return hydrated ? null : initial;
}
