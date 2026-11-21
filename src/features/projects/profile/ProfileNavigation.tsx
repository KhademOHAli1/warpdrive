/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Adapted from apps/web/app/(all)/[workspaceSlug]/(projects)/profile/[userId]/navbar.tsx
 * in Plane Community v1.5.0, commit 18caf808a3af3fcabeeba7d1e8473f1367bff2d4.
 */

import Link from "next/link";
import type { FormattingPreferences } from "@/lib/localeFormatting";
import { cn } from "@/lib/utils";
import type { ProfileTab } from "./contracts";
import { projectProfileTranslator } from "./messages";
import { PROJECT_PROFILE_PATH, profileItemsPath } from "./paths";

type Props = {
  active: ProfileTab;
  preferences: FormattingPreferences;
};

export function ProfileNavigation({ active, preferences }: Props) {
  const t = projectProfileTranslator(preferences.locale, preferences.numberingSystem);
  const tabsList = [
    { key: "summary", route: PROJECT_PROFILE_PATH },
    { key: "assigned", route: profileItemsPath("assigned") },
    { key: "created", route: profileItemsPath("created") },
  ] as const;

  return (
    <nav aria-label={t("navigation")} className="flex flex-wrap gap-1 border-b">
      {tabsList.map((tab) => (
        <Link
          key={tab.key}
          href={tab.route}
          aria-current={active === tab.key ? "page" : undefined}
          className={cn(
            "border-b-2 px-3 py-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
            active === tab.key
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {t(tab.key)}
        </Link>
      ))}
    </nav>
  );
}
