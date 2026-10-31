"use client";

import type { ReactNode } from "react";
import { LanguageSwitcher } from "@/features/i18n/LanguageSwitcher";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { directionForLocale } from "@/features/i18n/registry";

export function AuthFrame({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}): ReactNode {
  const locale = useLocale();
  return (
    <main
      dir={directionForLocale(locale)}
      className="flex min-h-dvh flex-col items-center justify-center bg-background px-5 py-12 sm:px-8"
    >
      <div className="w-full max-w-[25rem]">
        <div className="mb-10 flex items-center justify-between gap-4">
          <span
            dir="ltr"
            className="flex items-center gap-2.5 text-lg font-semibold tracking-tight"
          >
            <span
              aria-hidden="true"
              className="flex h-6 w-6 -skew-x-12 items-center gap-[3px] text-action"
            >
              <i className="h-3.5 w-1 rounded-[1px] bg-current" />
              <i className="h-5 w-1 rounded-[1px] bg-current" />
              <i className="h-4 w-1 rounded-[1px] bg-current" />
            </span>
            Warpdrive
          </span>
          <LanguageSwitcher />
        </div>
        <header className="mb-8 space-y-3">
          <h1 className="text-balance text-xl font-semibold tracking-tight">{title}</h1>
          {description !== undefined && (
            <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
              {description}
            </p>
          )}
        </header>
        <div className="space-y-5 [&_input]:h-11 [&_button[type=submit]]:h-11">{children}</div>
      </div>
    </main>
  );
}
