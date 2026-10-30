"use client";
import {
  Bell,
  Building2,
  Eye,
  Globe2,
  ListChecks,
  type LucideIcon,
  Mail,
  MailCheck,
  Palette,
  Plug,
  ShieldCheck,
  Sparkles,
  Table2,
  Target,
  Upload,
  User,
  Users,
  UsersRound,
} from "lucide-react";
import { usePathname } from "next/navigation";
import type React from "react";
import { useId } from "react";
import { SecondaryNavLink } from "@/components/navigation/SecondaryNavLink";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}
interface NavSection {
  id: string;
  title: string;
  items: NavItem[];
}

// Group by the task being configured. Existing permission gates and URLs remain authoritative.
export function SettingsNav({
  isAdmin,
  canManageCompany,
  canImport,
}: {
  isAdmin: boolean;
  canManageCompany: boolean;
  canImport: boolean;
}): React.ReactNode {
  const L = useSettingsMessages();
  const H = L._hierarchy;
  const id = useId();
  const pathname = usePathname();
  const sections: NavSection[] = [
    {
      id: "personal",
      title: H.personal,
      items: [
        { href: "/settings/profile", label: H.profile, icon: User },
        { href: "/settings/regional", label: H.regional, icon: Globe2 },
        { href: "/settings/appearance", label: H.appearance, icon: Palette },
        { href: "/settings/workflow", label: H.workflow, icon: ListChecks },
        { href: "/settings/notifications", label: L.notifications, icon: Bell },
      ],
    },
    ...(canManageCompany
      ? [
          {
            id: "workspace",
            title: H.workspace,
            items: [
              { href: "/settings/company", label: H.workspaceDetails, icon: Building2 },
              { href: "/settings/users", label: L.users, icon: Users },
              { href: "/settings/teams", label: L.teams, icon: UsersRound },
              { href: "/settings/permission-sets", label: L.permissionSets, icon: ShieldCheck },
              { href: "/settings/visibility-groups", label: L.visibilityGroups, icon: Eye },
            ],
          },
          {
            id: "sales",
            title: H.salesWorkflow,
            items: [
              { href: "/settings/company/pipelines", label: L.pipelines, icon: ListChecks },
              { href: "/settings/company/activities", label: H.activityTypes, icon: ListChecks },
              { href: "/settings/goals", label: L.goals, icon: Target },
              { href: "/settings/company/labels", label: L.labels, icon: Table2 },
              { href: "/settings/company/lost-reasons", label: L.lostReasons, icon: ListChecks },
            ],
          },
        ]
      : []),
    {
      id: "email",
      title: H.email,
      items: [
        { href: "/settings/email-sync", label: L.emailSync, icon: MailCheck },
        { href: "/settings/email", label: H.emailContent, icon: Mail },
      ],
    },
    {
      id: "data",
      title: H.dataIntegrations,
      items: [
        ...(canManageCompany
          ? [{ href: "/settings/fields", label: L.dataFields, icon: Table2 }]
          : []),
        ...(canImport ? [{ href: "/settings/import", label: L.importData, icon: Upload }] : []),
        { href: "/settings/connections", label: L.connectedApps, icon: Plug },
        // Enrichment requires a real administrator; MANAGE alone is insufficient.
        ...(isAdmin
          ? [{ href: "/settings/enrichment", label: L._enrichment.nav, icon: Sparkles }]
          : []),
      ],
    },
  ];
  // Nested company routes are their own destinations, so only the most specific link is active.
  const activeHref = sections
    .flatMap((section) => section.items)
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <nav
      aria-label={L._extra.settingsSections}
      className="w-full shrink-0 space-y-6 md:sticky md:top-4 md:max-h-[calc(100dvh-6rem)] md:w-60 md:self-start md:overflow-y-auto md:pe-2"
    >
      {sections.map((section) => (
        <section key={section.id} aria-labelledby={`${id}-${section.id}`}>
          <h2
            id={`${id}-${section.id}`}
            className="mb-2 px-2 text-xs font-semibold text-muted-foreground"
          >
            {section.title}
          </h2>
          <ul className="space-y-0.5">
            {section.items.map((item) => (
              <li key={item.href}>
                <SecondaryNavLink
                  href={item.href}
                  label={item.label}
                  icon={item.icon}
                  active={activeHref === item.href}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
  );
}
