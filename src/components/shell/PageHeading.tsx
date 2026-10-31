"use client";

import Link from "next/link";
import type React from "react";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";

export interface Crumb {
  label: string;
  // A parent crumb links somewhere; the current (last) crumb omits href and renders as plain text.
  href?: string;
}

// Shared page heading: a Pipedrive-style breadcrumb over a 25px page title. Centralizing the title
// size + breadcrumb here stops the per-page drift (bare 18-20px titles, no breadcrumb) the parity
// specs flagged across settings, contacts, leads, and inbox.
export function PageHeading({
  title,
  crumbs,
  description,
  actions,
}: {
  title: string;
  crumbs?: Crumb[];
  description?: React.ReactNode;
  actions?: React.ReactNode;
}): React.ReactNode {
  const t = useAppTranslations("utilities");
  return (
    <div className="mb-4">
      {crumbs !== undefined && crumbs.length > 0 ? (
        <nav aria-label={t("breadcrumb")} className="mb-1">
          <ol className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
            {crumbs.map((crumb, i) => {
              const isLast = i === crumbs.length - 1;
              return (
                <li
                  key={`${crumb.label}-${crumb.href ?? "current"}`}
                  className="flex min-w-0 items-center gap-1 [overflow-wrap:anywhere]"
                >
                  {i > 0 ? (
                    <span aria-hidden="true" className="text-muted-foreground/60">
                      /
                    </span>
                  ) : null}
                  {crumb.href !== undefined && !isLast ? (
                    <Link href={crumb.href} className="hover:text-foreground">
                      <bdi dir="auto">{crumb.label}</bdi>
                    </Link>
                  ) : (
                    <span aria-current={isLast ? "page" : undefined} className="text-foreground">
                      <bdi dir="auto">{crumb.label}</bdi>
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>
      ) : null}
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row">
        {/* Inter is a vendored variable font, so the 450 weight (lighter than semibold) resolves. */}
        <h1 className="min-w-0 max-w-full hyphens-auto text-display font-[450] leading-tight tracking-tight [overflow-wrap:anywhere]">
          <bdi dir="auto">{title}</bdi>
        </h1>
        {actions}
      </div>
      {description !== undefined ? (
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}
