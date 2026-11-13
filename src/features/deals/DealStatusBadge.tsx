"use client";
import type React from "react";
import { Badge, type BadgeProps } from "@/components/ui/Badge";
import type { DealStatus } from "@/constants/dealStatus";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";

const STATUS_PRESENTATION = {
  open: { variant: "secondary", label: "computed.statusOpen" },
  won: { variant: "success", label: "computed.statusWon" },
  lost: { variant: "destructive", label: "computed.statusLost" },
} as const satisfies Record<DealStatus, { variant: BadgeProps["variant"]; label: string }>;

export function DealStatusBadge({
  status,
  presentation = "compact",
}: {
  status: DealStatus | undefined;
  presentation?: "compact" | "detail";
}): React.ReactNode {
  const translateSales = useAppTranslations("sales");
  const compact = presentation === "compact";
  if (status === undefined || (status === "open" && compact)) return null;

  const { variant, label: labelKey } = STATUS_PRESENTATION[status];
  const label = translateSales(labelKey);
  return (
    <Badge
      variant={variant}
      data-deal-status={compact ? status : undefined}
      aria-label={compact ? undefined : translateSales("deal_status_arg0_ccb52", { arg0: label })}
    >
      {label}
    </Badge>
  );
}
