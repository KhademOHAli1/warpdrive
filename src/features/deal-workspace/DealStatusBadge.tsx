"use client";
import type React from "react";
import { Badge, type BadgeProps } from "@/components/ui/Badge";
import type { DealStatus } from "@/constants/dealStatus";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";

const STATUS_PRESENTATION: Record<DealStatus, { variant: NonNullable<BadgeProps["variant"]> }> = {
  open: { variant: "secondary" },
  won: { variant: "success" },
  lost: { variant: "destructive" },
};

export function DealStatusBadge({ status }: { status: DealStatus }): React.ReactNode {
  const translateSales = useAppTranslations("sales");

  const presentation = STATUS_PRESENTATION[status];
  const label = translateSales(
    `computed.status${status === "open" ? "Open" : status === "won" ? "Won" : "Lost"}`,
  );
  return (
    <Badge
      variant={presentation.variant}
      aria-label={translateSales("deal_status_arg0_ccb52", { arg0: label })}
    >
      {label}
    </Badge>
  );
}
