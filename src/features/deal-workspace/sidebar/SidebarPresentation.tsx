"use client";

import { createContext, useContext } from "react";

// Defaults preserve the shared contact/lead sections. Only the deal workspace opts into restraint.
export const SidebarPresentation = createContext({ compact: false, hideEmpty: false });
export function useSidebarPresentation() {
  return useContext(SidebarPresentation);
}
