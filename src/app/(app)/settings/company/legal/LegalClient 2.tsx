"use client";
import { CompanyScreen } from "@/features/company-profile/ui/CompanyScreen";
import { LegalManager } from "@/features/company-profile/ui/LegalManager";
export function LegalClient({ actorId }: { actorId: string }) {
  return (
    <CompanyScreen key={actorId}>
      {(data, reload) => <LegalManager data={data} actorId={actorId} reload={reload} />}
    </CompanyScreen>
  );
}
