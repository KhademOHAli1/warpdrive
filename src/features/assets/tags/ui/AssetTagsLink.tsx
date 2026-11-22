"use client";

import { QrCode } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/Button";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { assetTagWords } from "./tagMessages";

export function AssetTagsLink() {
  const locale = useLocale();
  return (
    <Link href="/assets/tags" className={buttonVariants({ variant: "outline", size: "sm" })}>
      <QrCode size={14} aria-hidden="true" />
      {assetTagWords[locale].title}
    </Link>
  );
}
