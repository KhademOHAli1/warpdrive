"use client";

import { MapPin } from "lucide-react";
import Link from "next/link";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { locationsMessages } from "./locationsMessages";

export function LocationDirectoryLink() {
  const locale = useLocale();
  return (
    <Link
      href="/locations"
      prefetch={false}
      className="inline-flex items-center gap-2 border-b-2 border-transparent px-2 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
    >
      <MapPin aria-hidden="true" className="size-4" /> {locationsMessages[locale].title}
    </Link>
  );
}
