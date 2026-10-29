"use client";
import { Building2, History, Users } from "lucide-react";
import { usePathname } from "next/navigation";
import type React from "react";
import { SecondaryNavLink } from "@/components/navigation/SecondaryNavLink";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";

// Contacts vertical sub-sidebar (IA1): People / Organizations / Timeline as a left secondary rail.
// Its rows share the Settings secondary-nav component so icons, active treatment, and spacing stay
// identical. Active when the path is within the section (covers list and detail routes).
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
    <nav aria-label={tContacts("contactsSections")} className="w-56 shrink-0">
      <ul className="space-y-0.5">
        {ITEMS.map((item) => {
          const active = pathname === item.section || pathname.startsWith(`${item.section}/`);
          return (
            <li key={item.href}>
              <SecondaryNavLink
                href={item.href}
                label={item.label}
                icon={item.icon}
                active={active}
              />
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
