"use client";

/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Adapted from Plane Community v1.5.0, apps/web/components/navigation/use-navigation-items.ts.
 */

import {
  Archive,
  CalendarRange,
  FileText,
  Inbox,
  Layers3,
  ListFilter,
  Package,
  Settings,
} from "lucide-react";
import Link from "next/link";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { cn } from "@/lib/utils";
import { pageLabels } from "../documents/ui/pageLabels";
import { projectsTranslator } from "./projectMessages";

export function ProjectWorkspaceNav({
  projectId,
  active,
  canManageSettings = false,
  intakeEnabled = false,
}: {
  projectId: string;
  active:
    | "work_items"
    | "pages"
    | "cycles"
    | "modules"
    | "views"
    | "settings"
    | "intake"
    | "archive";
  canManageSettings?: boolean;
  intakeEnabled?: boolean;
}) {
  const { locale, numberingSystem } = useLocalePreferences();
  const labels = projectsTranslator(locale, numberingSystem);
  const root = `/projects/internal/${encodeURIComponent(projectId)}`;
  const navigationItems = [
    { key: "work_items", name: labels("workspace.workItems"), href: root, icon: Layers3 },
    { key: "cycles", name: labels("sections.cycles"), href: `${root}/cycles`, icon: CalendarRange },
    { key: "modules", name: labels("sections.modules"), href: `${root}/modules`, icon: Package },
    { key: "views", name: labels("sections.views"), href: `${root}/views`, icon: ListFilter },
    { key: "intake", name: labels("sections.intake"), href: `${root}/intake`, icon: Inbox },
    {
      key: "archive",
      name: labels("sections.workArchive"),
      href: `${root}/archive`,
      icon: Archive,
    },
    { key: "pages", name: pageLabels[locale].pages, href: `${root}/documents`, icon: FileText },
    {
      key: "settings",
      name: labels("sections.settings"),
      href: `${root}/settings`,
      icon: Settings,
    },
  ] as const;

  return (
    <nav aria-label={labels("workspace.views")} className="mb-4 flex flex-wrap gap-x-3 border-b">
      {navigationItems
        .filter(({ key }) => key !== "settings" || active === "settings" || canManageSettings)
        .filter(({ key }) => key !== "intake" || active === "intake" || intakeEnabled)
        .map(({ key, name, href, icon: Icon }) => (
          <Link
            key={key}
            href={href}
            aria-current={key === active ? "page" : undefined}
            className={cn(
              "inline-flex items-center gap-2 border-b-2 px-2 py-2 text-sm font-medium transition-colors",
              key === active
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon aria-hidden="true" className="size-4" />
            {name}
          </Link>
        ))}
    </nav>
  );
}
