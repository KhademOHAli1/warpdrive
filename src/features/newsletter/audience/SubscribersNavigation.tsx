"use client";

import { FileUp, MailX, Users } from "lucide-react";
import { usePathname } from "next/navigation";
import { SecondaryNavLink } from "@/components/navigation/SecondaryNavLink";
import { useAudienceMessages } from "./messages";

export function SubscribersNavigation() {
  const L = useAudienceMessages();
  const path = usePathname();
  const links = [
    { href: "/campaigns/subscribers", label: L.allSubscribers, icon: Users },
    { href: "/campaigns/subscribers/import", label: L.importSubscribers, icon: FileUp },
    { href: "/campaigns/subscribers/bounces", label: L.bounces, icon: MailX },
  ];
  return (
    <nav aria-label={L.subscribers} className="flex flex-wrap gap-1 border-b pb-3">
      {links.map((link) => (
        <SecondaryNavLink key={link.href} {...link} active={path === link.href} />
      ))}
    </nav>
  );
}
