"use client";
import { Fingerprint } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import { authScreensMessagesForLocale } from "./authScreensMessages";
import { authClient } from "./better/client";
import type { AuthProviders } from "./better/contracts";
import { AuthField } from "./ui/AuthField";
import { AuthFrame } from "./ui/AuthFrame";
import { safeAuthDestination } from "./ui/authUiModel";
import { useAuthProviders } from "./ui/useAccountStatus";
import { AuthFeedback, useAuthAction } from "./ui/useAuthAction";

export function LoginScreen({
  failed = false,
  config: initial,
  returnTo,
}: {
  failed?: boolean;
  config?: AuthProviders;
  returnTo?: string;
}): ReactNode {
  const messages = authScreensMessagesForLocale(useLocale());
  const L = messages.flow;
  const t = useAppTranslations("authScreens");
  const { config, error: configError, retry } = useAuthProviders(initial);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const task = useAuthAction();
  const router = useRouter();
  const destination =
    returnTo === undefined ? "" : `?returnTo=${encodeURIComponent(safeAuthDestination(returnTo))}`;
  const continuation = `/auth/continue${destination}`;
  const done = () => router.replace(continuation);
  function submit(event: FormEvent) {
    event.preventDefault();
    let needsFactor = false;
    void task.run(
      async (signal) => {
        const result = await authClient.signIn.email(
          { email: email.trim(), password, callbackURL: continuation },
          { signal },
        );
        needsFactor =
          result.data !== null &&
          "twoFactorRedirect" in result.data &&
          result.data.twoFactorRedirect === true;
        return result;
      },
      () => router.replace(needsFactor ? `/auth/mfa${destination}` : continuation),
    );
  }
  return (
    <AuthFrame title={messages.loginTitle} description={L.loginDescription}>
      {(failed || configError) && (
        <p role="alert" className="text-sm text-destructive">
          {failed ? messages.authFailed : L.networkError}
        </p>
      )}
      {configError && (
        <Button variant="outline" onClick={retry}>
          {L.retry}
        </Button>
      )}
      {!config && !configError && (
        <p role="status" className="text-sm text-muted-foreground">
          {L.working}
        </p>
      )}
      {config?.emailPassword === true && (
        <form onSubmit={submit} className="space-y-5">
          <AuthField
            label={L.email}
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={task.busy}
          />
          <AuthField
            label={L.password}
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={task.busy}
          />
          <Button type="submit" className="w-full" disabled={task.busy}>
            {task.busy ? L.working : L.signIn}
          </Button>
          <a
            className="block text-end text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            href="/auth/forgot-password"
          >
            {L.forgotPassword}
          </a>
        </form>
      )}
      {config && (config.passkeys || config.providers.length > 0) && (
        <div className="flex items-center gap-3 py-1">
          <span className="h-px flex-1 bg-border" />
          <span className="text-xs text-muted-foreground">{L.signInAlternative}</span>
          <span className="h-px flex-1 bg-border" />
        </div>
      )}
      <div className="space-y-3">
        {config?.passkeys === true && (
          <Button
            className="h-11 w-full"
            variant="outline"
            disabled={task.busy}
            onClick={() => void task.run(() => authClient.signIn.passkey(), done)}
          >
            <Fingerprint className="size-4" aria-hidden="true" />
            {L.signInWithPasskey}
          </Button>
        )}
        {config?.providers.map((provider) => (
          <Button
            className="h-11 w-full"
            variant="outline"
            key={provider.id}
            disabled={task.busy}
            onClick={() =>
              void task.run(() =>
                authClient.signIn.social({ provider: provider.id, callbackURL: continuation }),
              )
            }
          >
            {provider.id === "google"
              ? messages.signInWithGoogle
              : t("flow.signInWithProvider", { provider: provider.name })}
          </Button>
        ))}
      </div>
      <AuthFeedback error={task.error} notice={task.notice} />
      <a
        href="/auth/recovery"
        className="block text-center text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        {L.accountRecovery}
      </a>
      <p className="border-t pt-5 text-center text-xs leading-relaxed text-muted-foreground">
        {L.inviteOnly}
      </p>
    </AuthFrame>
  );
}
