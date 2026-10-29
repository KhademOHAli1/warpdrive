"use client";

import { createContext, type ReactNode, useContext } from "react";

const CompanyCurrency = createContext("USD");

export function CurrencyProvider({
  currency,
  children,
}: {
  currency: string;
  children: ReactNode;
}) {
  return <CompanyCurrency.Provider value={currency}>{children}</CompanyCurrency.Provider>;
}

export function useCompanyCurrency(): string {
  return useContext(CompanyCurrency);
}
