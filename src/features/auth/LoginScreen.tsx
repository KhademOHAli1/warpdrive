"use client";
import type { ReactNode } from "react";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { authScreensMessagesForLocale } from "./authScreensMessages";
export function LoginScreen({ failed = false }: { failed?: boolean }): ReactNode {
  const messages = authScreensMessagesForLocale(useLocale());
  return (
    <main className="flex h-screen items-center justify-center">
      <div className="w-80 space-y-4 rounded-lg border p-6 text-center">
        <h1 className="text-balance text-xl font-semibold">{messages.loginTitle}</h1>
        <p className="text-pretty text-sm text-muted-foreground">{messages.domainOnly}</p>
        {failed && (
          <p role="alert" className="text-sm text-destructive">
            {messages.authFailed}
          </p>
        )}
        <a
          href="/auth/start"
          className="inline-flex w-full items-center justify-center rounded-md bg-action px-4 py-2 text-sm text-action-foreground transition-transform active:scale-[0.96]"
        >
          {messages.signInWithGoogle}
        </a>
      </div>
    </main>
  );
}
