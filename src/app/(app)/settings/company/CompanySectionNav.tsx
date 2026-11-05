"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCompanyMessages } from "@/features/company-profile/messages";
import { cn } from "@/lib/utils";
export function CompanySectionNav() {
  const L = useCompanyMessages();
  const path = usePathname();
  const links = [
    { href: "/settings/company", label: L.identity },
    { href: "/settings/company/branding", label: L.branding },
    { href: "/settings/company/legal", label: L.legal },
    { href: "/settings/company/work-profile", label: L.workProfile },
  ];
  return (
    <nav aria-label={L.identity} className="mb-6 flex flex-wrap gap-1 border-b pb-3">
      {links.map((v) => (
        <Link
          key={v.href}
          href={v.href}
          aria-current={path === v.href ? "page" : undefined}
          className={cn(
            "rounded-md px-3 py-2 text-sm hover:bg-muted",
            path === v.href && "bg-muted font-medium",
          )}
        >
          {v.label}
        </Link>
      ))}
    </nav>
  );
}
