"use client";
import { CompanyScreen } from "@/features/company-profile/ui/CompanyScreen";
import { DetailsEditor } from "@/features/company-profile/ui/DetailsEditor";
export function CompanyGeneralClient({ actorId }: { actorId: string }) {
  return (
    <CompanyScreen key={actorId}>
      {(data, reload) => <DetailsEditor data={data} actorId={actorId} reload={reload} />}
    </CompanyScreen>
  );
}
