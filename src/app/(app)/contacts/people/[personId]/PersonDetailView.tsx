import { notFound, redirect } from "next/navigation";
import type React from "react";
import { CustomFieldRefLabelsProvider } from "@/features/custom-fields/refLabelsContext";
import { cachedDetailLoad } from "@/features/navigation/cachedDetailLoad";
import { hasNewsletterPermission } from "@/features/newsletter/permissions";
import { can } from "@/features/permissions/can";
import type { VisiblePersonOrOrg } from "@/features/permissions/types";
import { getPersonDetail } from "@/frontend/reads";
import { err, ok } from "@/types/result";
import { PersonDetailClient } from "./PersonDetailClient";

// Shared person-detail loader. Exported so both the full page ([personId]/page.tsx) and the
// intercepted slide-over drawer (@modal/(.)[personId]/page.tsx) render identical content from one
// source, and generateMetadata can reuse the cached load.
export const loadPerson = cachedDetailLoad(async (_ctx, _actor, id) => {
  const detail = await getPersonDetail(id);
  return detail === null ? err("notfound") : ok(detail.person);
});

// The person detail body (header + sidebar + timeline), independent of whether it renders as a
// full page or inside the drawer. notFound()/redirect() work in both contexts (server components).
export async function PersonDetailView({
  personId,
}: {
  personId: string;
}): Promise<React.ReactNode> {
  const loaded = await loadPerson(personId);
  if (loaded.kind === "unauth") {
    redirect("/login");
  }
  if (loaded.kind === "notfound") {
    notFound();
  }
  const { actor, value: person } = loaded;
  const detail = await getPersonDetail(personId);
  if (detail === null) notFound();
  const { defs, baseCurrency, hidden, refLabels, orgName } = detail;
  const { followers, isFollowedBySelf } = detail.followers;

  const record: VisiblePersonOrOrg = {
    kind: "person",
    ownerId: person.ownerId,
    visibilityLevel: person.visibilityLevel,
    visibilityGroupId: person.visibilityGroupId,
    visibleToUserIds: person.visibleToUserIds,
  };
  const canMerge = can(actor, "contact.merge", record);
  const canDelete = can(actor, "contact.delete", record);

  return (
    <CustomFieldRefLabelsProvider value={refLabels}>
      <PersonDetailClient
        person={person}
        orgName={orgName}
        defs={defs}
        hiddenBuiltins={hidden.person}
        canMerge={canMerge}
        canDelete={canDelete}
        canViewNewsletter={hasNewsletterPermission(actor, "view")}
        canManageNewsletter={hasNewsletterPermission(actor, "consent")}
        canCreateAttributedLead={actor.type === "admin" || actor.flags.has("deal.create")}
        baseCurrency={baseCurrency}
        followers={followers}
        isFollowedBySelf={isFollowedBySelf}
      />
    </CustomFieldRefLabelsProvider>
  );
}
