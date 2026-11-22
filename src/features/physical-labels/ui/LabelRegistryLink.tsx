"use client";

import { Tags } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/Button";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { labelMessages } from "./labelMessages";

export function LabelRegistryLink() {
  const t = labelMessages[useLocale()];
  return (
    <Link href="/operations/labels" className={buttonVariants({ variant: "outline", size: "sm" })}>
      <Tags size={14} aria-hidden="true" /> {t.labels}
    </Link>
  );
}
