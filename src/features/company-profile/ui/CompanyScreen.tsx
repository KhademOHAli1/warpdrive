"use client";
import type { ReactNode } from "react";
import { SettingsPage } from "@/app/(app)/settings/SettingsSurface";
import { Button } from "@/components/ui/Button";
import { type CompanyOverview, companyOverviewSchema } from "../contracts";
import { useCompanyMessages } from "../messages";
import { ProfileError } from "./CommandFeedback";
import { PRIVATE } from "./Fields";
import { DepartureGuardProvider } from "./useDepartureGuard";
import { useProfileResource } from "./useProfileApi";

export function CompanyScreen({
  children,
}: {
  children: (data: CompanyOverview, reload: () => Promise<void>) => ReactNode;
}) {
  const m = useCompanyMessages();
  const resource = useProfileResource("/api/company-profile/overview", companyOverviewSchema);
  return (
    <DepartureGuardProvider>
      <SettingsPage className={`${PRIVATE} max-w-4xl`}>
        {resource.error !== null ? (
          <div className="space-y-3">
            <ProfileError code={resource.error} />
            <Button variant="outline" onClick={() => void resource.reload()}>
              {m.refresh}
            </Button>
          </div>
        ) : null}
        {resource.data !== null ? (
          children(resource.data, resource.reload)
        ) : resource.loading ? (
          <p role="status">{m.loading}</p>
        ) : null}
      </SettingsPage>
    </DepartureGuardProvider>
  );
}
