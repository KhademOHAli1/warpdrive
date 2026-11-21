"use client";

import { LibraryBig } from "lucide-react";
import Link from "next/link";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { LocationDirectoryLink } from "@/features/locations/LocationDirectoryLink";
import { catalogMessages } from "../catalog/ui/catalogMessages";

export function InventoryCatalogLinks() {
  const locale = useLocale();
  return (
    <>
      <Link
        href="/inventory/catalog"
        prefetch={false}
        className="inline-flex items-center gap-2 border-b-2 border-transparent px-2 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <LibraryBig aria-hidden="true" className="size-4" /> {catalogMessages[locale].title}
      </Link>
      <LocationDirectoryLink />
    </>
  );
}
