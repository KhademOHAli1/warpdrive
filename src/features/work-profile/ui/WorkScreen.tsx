"use client";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { useCompanyMessages } from "@/features/company-profile/messages";
import { ProfileError } from "@/features/company-profile/ui/CommandFeedback";
import { PRIVATE } from "@/features/company-profile/ui/Fields";
import { DepartureGuardProvider } from "@/features/company-profile/ui/useDepartureGuard";
import { useProfileResource } from "@/features/company-profile/ui/useProfileApi";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { type Overview, overviewSchema } from "../contracts";
export function WorkScreen({
  children,
}: {
  children: (data: Overview, reload: () => Promise<void>) => ReactNode;
}) {
  const locale = useLocale();
  const m = useCompanyMessages();
  const resource = useProfileResource(
    `/api/work-profile/overview?locale=${locale}`,
    overviewSchema,
  );
  return (
    <DepartureGuardProvider>
      <div className={`${PRIVATE} space-y-5`}>
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
      </div>
    </DepartureGuardProvider>
  );
}
