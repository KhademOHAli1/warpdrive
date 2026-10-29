"use client";
import type React from "react";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { AttributionLine } from "./AttributionLine";

// "Deal created" anchor (synthesized from deal.createdAt, decision 1). A titled
// line plus the shared attribution, matching Pipedrive's create event.
export function CreatedCard({
  at,
  actorName,
}: {
  at: Date;
  actorName: string | null;
}): React.ReactNode {
  const translateSales = useAppTranslations("sales");

  return (
    <div className="py-0.5">
      <p className="text-sm font-medium text-foreground">{translateSales("deal_created_5f6be")}</p>
      <AttributionLine at={at} actorName={actorName} />
    </div>
  );
}
