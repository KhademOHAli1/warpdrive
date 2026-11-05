"use client";
import { createContext, type ReactNode, useContext } from "react";
import { APP_NAME } from "@/constants/app";
import { workspaceNavItems } from "@/constants/workspaceNavigation";
export type WorkspaceBrand = {
  displayName: string;
  iconUrl: string | null;
  accentColor: string | null;
  foregroundColor: string;
};
type WorkspaceShell = { brand: WorkspaceBrand; modules: string[]; canViewWork: boolean };
const defaults: WorkspaceShell = {
  brand: { displayName: APP_NAME, iconUrl: null, accentColor: null, foregroundColor: "#ffffff" },
  modules: [] as string[],
  canViewWork: false,
};
const Context = createContext(defaults);
export function WorkspaceShellProvider({
  brand,
  modules,
  canViewWork,
  children,
}: {
  brand: WorkspaceBrand;
  modules: string[];
  canViewWork: boolean;
  children: ReactNode;
}) {
  return <Context.Provider value={{ brand, modules, canViewWork }}>{children}</Context.Provider>;
}
export function useWorkspaceShell() {
  return useContext(Context);
}
export function useWorkspaceNavigation() {
  const { modules, canViewWork } = useWorkspaceShell();
  return workspaceNavItems(modules, canViewWork);
}
