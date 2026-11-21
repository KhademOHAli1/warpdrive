"use client";

import Link from "next/link";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { cn } from "@/lib/utils";
import { projectProfileTranslator } from "./profile/messages";
import { projectsTranslator } from "./ui/projectMessages";

const pages = [
  { kind: "client", href: "/projects" },
  { kind: "internal", href: "/projects/internal" },
  { kind: "profile", href: "/projects/internal/profile" },
] as const;

export function ProjectTypeNav({ active }: { active: (typeof pages)[number]["kind"] }) {
  const { locale, numberingSystem } = useLocalePreferences();
  const t = projectsTranslator(locale, numberingSystem);
  const segment = "rounded-sm px-2.5 py-1 text-sm transition-colors";

  return (
    <nav
      aria-label={t("navigation.title")}
      className="inline-flex flex-wrap rounded-md border bg-card p-0.5"
    >
      {pages.map(({ kind, href }) => {
        const label =
          kind === "profile"
            ? projectProfileTranslator(locale, numberingSystem)("title")
            : t(`navigation.${kind}`);
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
