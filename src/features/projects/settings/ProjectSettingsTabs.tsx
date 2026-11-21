"use client";

import Link from "next/link";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { cn } from "@/lib/utils";
import { projectSettingsMessages } from "./messages";

const sections = ["general", "states", "labels", "estimates", "intake", "automations"] as const;
type SettingsSection = (typeof sections)[number];

export function ProjectSettingsTabs({
  projectId,
  active,
}: {
  projectId: string;
  active: SettingsSection;
}) {
  const { locale } = useLocalePreferences();
  const labels = projectSettingsMessages[locale];
  const path = `/projects/internal/${projectId}/settings`;
  return (
    <nav aria-label={labels.settings} className="mb-5 flex flex-wrap gap-1">
      {sections.map((section) => (
        <Link
          key={section}
          href={section === "general" ? path : `${path}/${section}`}
          aria-current={section === active ? "page" : undefined}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm",
            section === active ? "bg-accent font-medium" : "text-muted-foreground hover:bg-muted",
          )}
        >
          {labels[section]}
        </Link>
      ))}
    </nav>
  );
}
