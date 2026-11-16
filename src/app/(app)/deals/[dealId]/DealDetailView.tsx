import { notFound, redirect } from "next/navigation";
import type React from "react";
import { CustomFieldRefLabelsProvider } from "@/features/custom-fields/refLabelsContext";
import { DealDetailInitialFormatsProvider } from "@/features/deal-workspace/DealDetailInitialFormats";
import { toVisibleDeal } from "@/features/deals/dealAuth";
import { getLocalePreferences } from "@/features/i18n/server";
import { cachedDetailLoad } from "@/features/navigation/cachedDetailLoad";
import { can } from "@/features/permissions/can";
import { getDealDetail } from "@/frontend/reads";
import { formatCurrency } from "@/lib/formatCurrency";
import { formatDateOnly, formatDateTime } from "@/lib/localeFormatting";
import { err, ok } from "@/types/result";
import { DealWorkspaceClient } from "./DealWorkspaceClient";

// Shared deal-workspace loader. Exported so the full page ([dealId]/page.tsx), the intercepted
// slide-over drawer, and generateMetadata all share one cached read. Mirrors OrgDetailView.
export const loadDeal = cachedDetailLoad(async (_ctx, _actor, id) => {
  const detail = await getDealDetail(id);
  return detail === null ? err("notfound") : ok(detail.workspace);
});

export async function DealDetailView({ dealId }: { dealId: string }): Promise<React.ReactNode> {
  const loaded = await loadDeal(dealId);
  if (loaded.kind === "unauth") {
    redirect("/login");
  }
  if (loaded.kind === "notfound") {
    notFound();
  }

  const detail = await getDealDetail(dealId);
  if (detail === null) notFound();
  const {
    mailbox,
    prefs,
    baseCurrency,
    assignableUsers,
    orgOptions,
    personOptions,
    hiddenBuiltins,
    refLabels,
  } = detail;
  const localePreferences = await getLocalePreferences();

  // getWorkspace already read the pipeline row for its own visibility gate and hands back the
  // group, so this builds the same VisibleDeal without a second query for that row.
  const visibleDeal = toVisibleDeal(loaded.value.deal, loaded.value.pipelineVisibilityGroupId);
  const canChangeOwner = can(loaded.actor, "deal.changeOwner", visibleDeal);
  // Delete is gated on deal.delete (own/any), independent of edit; hide the menu item when the
  // actor lacks it. deleteDeal re-checks server-side, so this is UX only, not the security boundary.
  const canDelete = can(loaded.actor, "deal.delete", visibleDeal);
  const { deal } = loaded.value;
  const currency = deal.currency;
  const initialFormats = {
    summaryValue: `${formatCurrency(deal.value ?? 0, currency, localePreferences)} ${currency}`,
    headerValue:
      deal.value === null ? null : formatCurrency(deal.value, deal.currency, localePreferences),
    expectedCloseDate:
      deal.expectedCloseDate === null
        ? null
        : formatDateOnly(deal.expectedCloseDate, localePreferences),
    createdDate: formatDateTime(deal.createdAt, localePreferences, {
      year: "numeric",
      month: "short",
      day: "numeric",
    }),
  };

  return (
    <CustomFieldRefLabelsProvider value={refLabels}>
      <DealDetailInitialFormatsProvider initial={initialFormats}>
        <DealWorkspaceClient
          workspace={loaded.value}
          selfActorId={loaded.actor.id}
          emailAccountId={mailbox?.id ?? null}
          emailAddress={mailbox?.emailAddress}
          canChangeOwner={canChangeOwner}
          canDelete={canDelete}
          canManageFields={can(loaded.actor, "metadata.manage")}
          assignableUsers={assignableUsers}
          initialHiddenBlocks={prefs.ui.dealHeaderBlocks ?? []}
          initialSidebarSections={prefs.ui.dealSidebarSections}
          baseCurrency={baseCurrency}
          orgOptions={orgOptions}
          personOptions={personOptions}
          scheduleFollowUpAfterWon={prefs.ui.scheduleFollowUpAfterWon ?? false}
          hiddenOrgFields={hiddenBuiltins.organization}
          hiddenPersonFields={hiddenBuiltins.person}
        />
      </DealDetailInitialFormatsProvider>
    </CustomFieldRefLabelsProvider>
  );
}
