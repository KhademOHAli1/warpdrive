import { notFound, redirect } from "next/navigation";
import type React from "react";
import { CustomFieldRefLabelsProvider } from "@/features/custom-fields/refLabelsContext";
import { getAppTranslations } from "@/features/i18n/server";
import { createContext } from "@/frontend/context";
import { getLeadDetail } from "@/frontend/reads";
import { LeadWorkspaceClient } from "./LeadWorkspaceClient";

// Shared lead-detail loader. Exported so both the full page ([leadId]/page.tsx) and the intercepted
// slide-over drawer (@modal/(.)[leadId]/page.tsx) render identical content, and generateMetadata can
// reuse the load. Mirrors PersonDetailView / OrgDetailView.
export async function loadLead(leadId: string) {
  const ctx = await createContext();
  if (ctx.actor === null) return { kind: "unauth" as const };
  const detail = await getLeadDetail(leadId);
  if (detail === null) return { kind: "notfound" as const };
  return { kind: "ok" as const, lead: detail.lead, actor: ctx.actor };
}

export async function LeadDetailView({ leadId }: { leadId: string }): Promise<React.ReactNode> {
  const t = await getAppTranslations("leads");
  const loaded = await loadLead(leadId);
  if (loaded.kind === "unauth") redirect("/login");
  if (loaded.kind === "notfound") notFound();

  const detail = await getLeadDetail(leadId);
  if (detail === null) notFound();
  const {
    relations,
    hidden,
    personCustomFieldDefs,
    organizationCustomFieldDefs,
    leadCustomFieldDefs,
    baseCurrency,
    refLabels,
  } = detail;

  return (
    <main aria-label={t("leadText")} className="h-full">
      <CustomFieldRefLabelsProvider value={refLabels}>
        <LeadWorkspaceClient
          lead={loaded.lead}
          person={relations.person}
          org={relations.org}
          hiddenPersonFields={hidden.person}
          hiddenOrgFields={hidden.organization}
          personCustomFieldDefs={personCustomFieldDefs}
          organizationCustomFieldDefs={organizationCustomFieldDefs}
          leadCustomFieldDefs={leadCustomFieldDefs}
          baseCurrency={baseCurrency}
        />
      </CustomFieldRefLabelsProvider>
    </main>
  );
}
