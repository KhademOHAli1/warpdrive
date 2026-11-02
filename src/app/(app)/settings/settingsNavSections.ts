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
import { authScreensMessagesForLocale } from "@/features/auth/authScreensMessages";
import { managementMessagesForLocale } from "@/features/auth/management/messages";
import type { Locale } from "@/features/i18n/registry";
import type { SettingsMessages } from "@/features/identity/settingsMessages";
import { privacyRequestMessagesForLocale } from "@/features/privacy/privacyRequestMessages";

export interface SettingsNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}
export interface SettingsNavSection {
  id: string;
  title: string;
  items: SettingsNavItem[];
}

export interface SettingsNavAccess {
  isAdmin: boolean;
  canManageCompany: boolean;
  canImport: boolean;
}

// Keep permission gates beside the route inventory so search cannot expose hidden destinations.
export function settingsNavSections(
  L: SettingsMessages,
  locale: Locale,
  { isAdmin, canManageCompany, canImport }: SettingsNavAccess,
): SettingsNavSection[] {
  const H = L._hierarchy;
  const securityLabel = authScreensMessagesForLocale(locale).flow.securityTitle;
  const managementLabel = managementMessagesForLocale(locale).title;
  const privacyLabel = privacyRequestMessagesForLocale(locale).workspaceTitle;
  return [
    {
      id: "personal",
      title: H.personal,
      items: [
        { href: "/settings/profile", label: H.profile, icon: User },
        { href: "/settings/security", label: securityLabel, icon: ShieldCheck },
        { href: "/settings/privacy", label: privacyLabel, icon: ShieldCheck },
        { href: "/settings/regional", label: H.regional, icon: Globe2 },
        { href: "/settings/appearance", label: H.appearance, icon: Palette },
        { href: "/settings/workflow", label: H.workflow, icon: ListChecks },
        { href: "/settings/notifications", label: L.notifications, icon: Bell },
      ],
    },
    ...(isAdmin || canManageCompany
      ? [
          {
            id: "workspace",
            title: H.workspace,
            items: [
              { href: "/settings/company", label: H.workspaceDetails, icon: Building2 },
              { href: "/settings/users", label: L.users, icon: Users },
              { href: "/settings/security-admin", label: managementLabel, icon: ShieldCheck },
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
        ...(isAdmin || canManageCompany
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
}

export function activeSettingsItem(
  sections: SettingsNavSection[],
  pathname: string,
): SettingsNavItem | undefined {
  return sections
    .flatMap((section) => section.items)
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
}
