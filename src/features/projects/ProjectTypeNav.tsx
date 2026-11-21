"use client";

import Link from "next/link";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { cn } from "@/lib/utils";
import { projectsTranslator } from "./ui/projectMessages";

const pages = [
  { kind: "client", href: "/projects" },
  { kind: "internal", href: "/projects/internal" },
] as const;

export function ProjectTypeNav({ active }: { active: (typeof pages)[number]["kind"] }) {
  const { locale, numberingSystem } = useLocalePreferences();
  const t = projectsTranslator(locale, numberingSystem);
  const segment = "rounded-sm px-2.5 py-1 text-sm transition-colors";

  return (
    <nav aria-label={t("navigation.type")} className="inline-flex rounded-md border bg-card p-0.5">
      {pages.map(({ kind, href }) => {
        const label = t(`navigation.${kind}`);
        return active === kind ? (
          <span
            key={kind}
            aria-current="page"
            className={cn(segment, "bg-accent font-medium text-accent-foreground")}
          >
            {label}
          </span>
        ) : (
          <Link
            key={kind}
            href={href}
            className={cn(segment, "text-muted-foreground hover:text-foreground")}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
