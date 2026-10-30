"use client";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";
import { SettingsHeading } from "../SettingsHeading";
import { SettingsPage } from "../SettingsSurface";

// Keep bookmarked URLs while presenting each catalog under its own settings destination.
export default function CompanyLayout({ children }: { children: ReactNode }): ReactNode {
  const L = useSettingsMessages();
  const H = L._hierarchy;
  const pathname = usePathname();
  const general = { title: H.workspaceDetails, description: H.workspaceDescription };
  const pages: Record<string, { title: string; description: string }> = {
    "/settings/company": general,
    "/settings/company/activities": {
      title: H.activityTypes,
      description: H.activityTypesDescription,
    },
    "/settings/company/labels": { title: L.labels, description: H.labelsDescription },
    "/settings/company/lost-reasons": {
      title: L.lostReasons,
      description: H.lostReasonsDescription,
    },
    "/settings/company/pipelines": { title: L.pipelines, description: L.pipelinesDescription },
  };
  const page = pages[pathname] ?? general;
  return (
    <SettingsPage>
      <SettingsHeading title={page.title} description={page.description} scope="workspace" />
      {children}
    </SettingsPage>
  );
}
