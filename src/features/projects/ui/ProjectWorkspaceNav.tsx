/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Adapted from Plane Community v1.5.0, apps/web/components/navigation/use-navigation-items.ts.
 */

import { FileText, Layers3 } from "lucide-react";
import Link from "next/link";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { cn } from "@/lib/utils";
import { pageLabels } from "../documents/ui/pageLabels";
import { projectsTranslator } from "./projectMessages";

export function ProjectWorkspaceNav({
  projectId,
  active,
}: {
  projectId: string;
  active: "work_items" | "pages";
}) {
  const { locale, numberingSystem } = useLocalePreferences();
  const labels = projectsTranslator(locale, numberingSystem);
  const root = `/projects/internal/${encodeURIComponent(projectId)}`;
  const navigationItems = [
    { key: "work_items", name: labels("workspace.workItems"), href: root, icon: Layers3 },
    { key: "pages", name: pageLabels[locale].pages, href: `${root}/documents`, icon: FileText },
  ] as const;

  return (
    <nav aria-label={labels("workspace.views")} className="mb-4 flex gap-3 border-b">
      {navigationItems.map(({ key, name, href, icon: Icon }) => (
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
