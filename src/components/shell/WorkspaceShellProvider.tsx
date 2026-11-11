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
export type CampaignCapabilities = {
  edit: boolean;
  send: boolean;
  operate: boolean;
};
const noCampaignCapabilities: CampaignCapabilities = { edit: false, send: false, operate: false };

type WorkspaceShell = {
  brand: WorkspaceBrand;
  modules: string[];
  canViewWork: boolean;
  canViewProjects: boolean;
  canViewCampaigns: boolean;
  campaignCapabilities: CampaignCapabilities;
};
const defaults: WorkspaceShell = {
  brand: { displayName: APP_NAME, iconUrl: null, accentColor: null, foregroundColor: "#ffffff" },
  modules: [] as string[],
  canViewWork: false,
  canViewProjects: false,
  canViewCampaigns: false,
  campaignCapabilities: noCampaignCapabilities,
};
const Context = createContext(defaults);
export function WorkspaceShellProvider({
  brand,
  modules,
  canViewWork,
  canViewProjects = false,
  canViewCampaigns = false,
  campaignCapabilities = noCampaignCapabilities,
  children,
}: {
  brand: WorkspaceBrand;
  modules: string[];
  canViewWork: boolean;
  canViewProjects?: boolean;
  canViewCampaigns?: boolean;
  campaignCapabilities?: CampaignCapabilities;
  children: ReactNode;
}) {
  return (
    <Context.Provider
      value={{
        brand,
        modules,
        canViewWork,
        canViewProjects,
        canViewCampaigns,
        campaignCapabilities,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useWorkspaceShell() {
  return useContext(Context);
}
export function useWorkspaceNavigation() {
  const { modules, canViewWork, canViewProjects, canViewCampaigns } = useWorkspaceShell();
  return workspaceNavItems(modules, canViewWork, canViewProjects, canViewCampaigns);
}
