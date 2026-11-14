"use client";

import Link from "next/link";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { useFormatters } from "@/lib/useFormatters";
import { useDealDetailInitialFormats } from "../DealDetailInitialFormats";
import type { DealWorkspace } from "../summaryRepo";

export function DealKeyFacts({ workspace }: { workspace: DealWorkspace }) {
  const t = useAppTranslations("dealWorkspace");
  const format = useFormatters();
  const initialFormats = useDealDetailInitialFormats();
  const { deal, org } = workspace;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
      {org != null && (
        <Link href={`/contacts/orgs/${org.id}`} className="hover:text-foreground hover:underline">
          <bdi dir="auto">{org.name}</bdi>
        </Link>
      )}
      {deal.value != null && (
        <span className="font-medium tabular-nums text-foreground">
          {initialFormats?.headerValue ?? format.currency(deal.value, deal.currency)}
        </span>
      )}
      {deal.expectedCloseDate != null && (
        <span>
          {t("closes", {
            date: initialFormats?.expectedCloseDate ?? format.dateOnly(deal.expectedCloseDate),
          })}
        </span>
      )}
    </div>
  );
}
