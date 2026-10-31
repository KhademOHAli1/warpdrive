"use client";
import { Fingerprint } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useState } from "react";
import { Button } from "@/components/ui/Button";
import { PASSWORD_RESET_SUGGESTION_THRESHOLD } from "@/constants/authUi";
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
  const [passwordRejections, setPasswordRejections] = useState(0);
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
        signal.throwIfAborted();
        if (
          result.error?.code === "INVALID_EMAIL_OR_PASSWORD" ||
          result.error?.code === "INVALID_PASSWORD" ||
          result.error?.code === "INVALID_CREDENTIALS"
        )
          setPasswordRejections((count) =>
            Math.min(count + 1, PASSWORD_RESET_SUGGESTION_THRESHOLD),
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
  const passkeyAction = config?.passkeys === true && (
    <Button
      type="button"
      className="h-11 w-full rounded-lg"
      variant="outline"
      disabled={task.busy}
      onClick={() => void task.run(() => authClient.signIn.passkey(), done)}
    >
      <Fingerprint className="size-4 shrink-0" aria-hidden="true" />
      {L.signInWithPasskey}
    </Button>
  );
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
            name="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="rounded-lg bg-card px-3.5"
            required
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setPasswordRejections(0);
              task.setError(null);
            }}
            disabled={task.busy}
          />
          <AuthField
            label={L.password}
            type="password"
            autoComplete="current-password"
            name="password"
            className="rounded-lg bg-card px-3.5"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={task.busy}
          />
          <fieldset
            aria-label={L.signInOptions}
            className={
              config.passkeys
                ? "grid gap-3 min-[440px]:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]"
                : "grid gap-3"
            }
          >
            <Button type="submit" className="w-full rounded-lg" disabled={task.busy}>
              {task.busy ? L.working : L.signIn}
            </Button>
            {passkeyAction}
          </fieldset>
        </form>
      )}
      {config?.emailPassword !== true && passkeyAction}
      {config && config.providers.length > 0 && (config.emailPassword || config.passkeys) && (
        <div className="flex items-center gap-3 py-1">
          <span className="h-px flex-1 bg-border" />
          <span className="text-xs text-muted-foreground">{L.signInAlternative}</span>
          <span className="h-px flex-1 bg-border" />
        </div>
      )}
      {config && config.providers.length > 0 && (
        <div className="space-y-3">
          {config.providers.map((provider) => (
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
      )}
      <AuthFeedback error={task.error} notice={task.notice} />
      {passwordRejections >= PASSWORD_RESET_SUGGESTION_THRESHOLD && (
        <div role="status" className="space-y-2 rounded-lg border bg-muted/40 px-4 py-3 text-sm">
          <p className="leading-relaxed text-muted-foreground">{L.passwordResetSuggestion}</p>
          <a
            href="/auth/forgot-password"
            className="inline-block font-medium text-action underline-offset-4 hover:underline"
          >
            {L.resetTitle}
          </a>
        </div>
      )}
      <a
        href={`/auth/help${destination}`}
        className="block text-center text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        {L.signInHelp}
      </a>
      <p className="border-t pt-5 text-center text-xs leading-relaxed text-muted-foreground">
        {L.inviteOnly}
      </p>
    </AuthFrame>
  );
}
