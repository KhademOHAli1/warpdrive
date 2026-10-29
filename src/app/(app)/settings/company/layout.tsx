"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";
import { cn } from "@/lib/utils";
import { SettingsHeading } from "../SettingsHeading";
import { SettingsPage } from "../SettingsSurface";

// Company settings container: title + tab strip (Currencies omitted, out of scope).
export default function CompanyLayout({ children }: { children: ReactNode }): ReactNode {
  const L = useSettingsMessages();
  const TABS = [
    { href: "/settings/company", label: L.companyGeneral },
    { href: "/settings/company/activities", label: L.activities },
    { href: "/settings/company/lost-reasons", label: L.lostReasons },
    { href: "/settings/company/labels", label: L.labels },
    { href: "/settings/company/pipelines", label: L.pipelines },
  ] as const;

  const pathname = usePathname();
  return (
    <SettingsPage>
      <SettingsHeading title={L.companySettings} description={L.companySettingsDescription} />
      <nav aria-label={L._extra.company_settings} className="flex flex-wrap gap-1 border-b">
        {TABS.map((tab) => {
          const active = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
      <div>{children}</div>
    </SettingsPage>
  );
}
