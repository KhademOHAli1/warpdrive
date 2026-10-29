"use client";
import type React from "react";
import { Badge } from "@/components/ui/Badge";
import type { DealStatus } from "@/constants/dealStatus";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";

export function DealStatusBadge({ status }: { status: DealStatus | undefined }): React.ReactNode {
  const translateSales = useAppTranslations("sales");

  if (status === "won") {
    return (
      <Badge variant="success" data-deal-status="won">
        {translateSales("computed.statusWon")}
      </Badge>
    );
  }
  if (status === "lost") {
    return (
      <Badge variant="destructive" data-deal-status="lost">
        {translateSales("computed.statusLost")}
      </Badge>
    );
  }
  return null;
}
