import { notFound, redirect } from "next/navigation";
import type React from "react";
import { CustomFieldRefLabelsProvider } from "@/features/custom-fields/refLabelsContext";
import { cachedDetailLoad } from "@/features/navigation/cachedDetailLoad";
import { can } from "@/features/permissions/can";
import type { VisiblePersonOrOrg } from "@/features/permissions/types";
import { getOrgDetail } from "@/frontend/reads";
import { err, ok } from "@/types/result";
import { OrgDetailClient } from "./OrgDetailClient";

// Shared org-detail loader. Exported so both the full page ([orgId]/page.tsx) and the intercepted
// slide-over drawer (@modal/(.)[orgId]/page.tsx) render identical content, and generateMetadata can
// reuse the cached load. Mirrors PersonDetailView.
export const loadOrg = cachedDetailLoad(async (_ctx, _actor, id) => {
  const detail = await getOrgDetail(id);
  return detail === null ? err("notfound") : ok(detail.org);
});

export async function OrgDetailView({ orgId }: { orgId: string }): Promise<React.ReactNode> {
  const loaded = await loadOrg(orgId);
  if (loaded.kind === "unauth") {
    redirect("/login");
  }
  if (loaded.kind === "notfound") {
    notFound();
  }
  const { actor, value: org } = loaded;

  const detail = await getOrgDetail(orgId);
  if (detail === null) notFound();
  const { defs, baseCurrency, hidden, refLabels } = detail;
  const { followers, isFollowedBySelf } = detail.followers;

  const record: VisiblePersonOrOrg = {
    kind: "organization",
    ownerId: org.ownerId,
    visibilityLevel: org.visibilityLevel,
    visibilityGroupId: org.visibilityGroupId,
    visibleToUserIds: org.visibleToUserIds,
  };
  const canMerge = can(actor, "contact.merge", record);
  const canDelete = can(actor, "contact.delete", record);

  return (
    <CustomFieldRefLabelsProvider value={refLabels}>
      <OrgDetailClient
        org={org}
        defs={defs}
        hiddenBuiltins={hidden.organization}
        canMerge={canMerge}
        canDelete={canDelete}
        baseCurrency={baseCurrency}
        followers={followers}
        isFollowedBySelf={isFollowedBySelf}
      />
    </CustomFieldRefLabelsProvider>
  );
}
