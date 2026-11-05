"use client";
import { BrandingEditor } from "@/features/company-profile/ui/BrandingEditor";
import { CompanyScreen } from "@/features/company-profile/ui/CompanyScreen";
export function BrandingClient({ actorId }: { actorId: string }) {
  return (
    <CompanyScreen key={actorId}>
      {(data, reload) => <BrandingEditor data={data} actorId={actorId} reload={reload} />}
    </CompanyScreen>
  );
}
