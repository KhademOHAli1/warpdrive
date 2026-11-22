"use client";

import { ClipboardCheck } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/Button";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { auditMessages } from "./messages";

export function EquipmentAuditsLink({ available }: { available: boolean }) {
  const locale = useLocale();
  if (!available) return null;
  return (
    <Link href="/assets/audits" className={buttonVariants({ variant: "outline", size: "sm" })}>
      <ClipboardCheck size={14} aria-hidden="true" /> {auditMessages[locale].title}
    </Link>
  );
}
