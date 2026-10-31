"use client";

import { KeyRound } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/Button";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { cn } from "@/lib/utils";
import { authScreensMessagesForLocale } from "../authScreensMessages";
import type { AuthProviders } from "../better/contracts";
import { AssistedRecovery } from "./AssistedRecovery";
import { AuthFrame } from "./AuthFrame";
import { safeAuthDestination } from "./authUiModel";
import { useAuthProviders } from "./useAccountStatus";

export function SignInHelpScreen({
  config: initial,
  returnTo,
}: {
  config?: AuthProviders;
  returnTo?: string;
}) {
  const L = authScreensMessagesForLocale(useLocale()).flow;
  const { config, error, retry } = useAuthProviders(initial);
  const destination =
    returnTo === undefined ? "" : `?returnTo=${encodeURIComponent(safeAuthDestination(returnTo))}`;
  return (
    <AuthFrame title={L.signInHelpTitle} description={L.signInHelpDescription}>
      {error && (
        <div className="space-y-3">
          <p role="alert" className="text-sm text-destructive">
            {L.networkError}
          </p>
          <Button variant="outline" onClick={retry}>
            {L.retry}
          </Button>
        </div>
      )}
      {!config && !error && (
        <p role="status" className="text-sm text-muted-foreground">
          {L.working}
        </p>
      )}
      {config?.emailPassword === true && (
        <section className="space-y-4 rounded-lg border bg-card p-5">
          <div className="flex items-start gap-3">
            <KeyRound className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="space-y-2">
              <h2 className="text-sm font-semibold">{L.resetTitle}</h2>
              <p className="text-sm leading-relaxed text-muted-foreground">{L.passwordResetHelp}</p>
            </div>
          </div>
          <a
            href="/auth/forgot-password"
            className={cn(buttonVariants({ variant: "outline" }), "h-11 w-full")}
          >
            {L.resetTitle}
          </a>
        </section>
      )}
      <AssistedRecovery />
      <p className="text-xs leading-relaxed text-muted-foreground">{L.recoveryCodeHelp}</p>
      <a
        href={`/login${destination}`}
        className="block text-center text-sm text-action underline-offset-4 hover:underline"
      >
        {L.backToLogin}
      </a>
    </AuthFrame>
  );
}
