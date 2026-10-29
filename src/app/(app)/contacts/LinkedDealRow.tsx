"use client";
import Link from "next/link";
import type React from "react";
import type { DealStatus } from "@/constants/dealStatus";
import { DealStatusBadge } from "@/features/deal-workspace/DealStatusBadge";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";

export interface LinkedDealRowProps {
  deal: { id: string; title: string; status: DealStatus };
}

// Shared contact-sidebar deal row: title and lifecycle status stay aligned and identical on the
// Person and Organization surfaces.
export function LinkedDealRow({ deal }: LinkedDealRowProps): React.ReactNode {
  const t = useAppTranslations("contacts");
  const locale = useLocale();
  return (
    <li>
      <Link
        href={`/deals/${deal.id}`}
        aria-label={t("dealStatus", {
          title: deal.title,
          status: locale === "en" ? deal.status : t(deal.status),
        })}
        className="group flex min-h-10 items-center justify-between gap-3 rounded px-1 py-1 text-sm transition-colors duration-150 hover:bg-accent motion-reduce:transition-none"
      >
        <span className="min-w-0 truncate text-primary group-hover:underline">
          <bdi dir="auto">{deal.title}</bdi>
        </span>
        <DealStatusBadge status={deal.status} />
      </Link>
    </li>
  );
}
