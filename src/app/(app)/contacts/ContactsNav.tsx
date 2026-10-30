"use client";
import { Building2, History, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type React from "react";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { cn } from "@/lib/utils";

// Horizontal section navigation preserves context without adding a second sidebar.
// Active detection covers both the directory and its detail routes.
export function ContactsNav(): React.ReactNode {
  const tContacts = useAppTranslations("contacts");
  const ITEMS = [
    {
      href: "/contacts/people",
      label: tContacts("people"),
      section: "/contacts/people",
      icon: Users,
    },
    {
      href: "/contacts/orgs",
      label: tContacts("organizations"),
      section: "/contacts/orgs",
      icon: Building2,
    },
    {
      href: "/contacts/timeline",
      label: tContacts("timeline"),
      section: "/contacts/timeline",
      icon: History,
    },
  ] as const;

  const pathname = usePathname();
  return (
    <nav aria-label={tContacts("contactsSections")} className="overflow-x-auto border-b">
      <ul className="flex min-w-max gap-6">
        {ITEMS.map((item) => {
          const active = pathname === item.section || pathname.startsWith(`${item.section}/`);
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 border-b-2 px-1 pb-3 pt-1 text-sm transition-colors",
                  active
                    ? "border-primary font-semibold text-primary"
                    : "border-transparent font-medium text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon aria-hidden="true" className="size-4" />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
