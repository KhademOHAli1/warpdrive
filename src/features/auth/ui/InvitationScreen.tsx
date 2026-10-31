"use client";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import type { z } from "zod";
import { Button } from "@/components/ui/Button";
import {
  useAppTranslations,
  useLocale,
  useLocalePreferences,
} from "@/features/i18n/LocaleProvider";
import { authScreensMessagesForLocale } from "../authScreensMessages";
import { authClient } from "../better/client";
import { AuthField } from "./AuthField";
import { AuthFrame } from "./AuthFrame";
import { authErrorMessage, formatAuthDate } from "./authUiModel";
import { useAuthProviders } from "./useAccountStatus";
import { AuthFeedback, useAuthAction } from "./useAuthAction";
import { invitationSchema, workflowRequest } from "./workflowRequest";

export function InvitationScreen({ token }: { token: string }) {
  const locale = useLocale();
  const t = useAppTranslations("authScreens");
  const preferences = useLocalePreferences();
  const L = authScreensMessagesForLocale(locale).flow;
  const task = useAuthAction();
  const router = useRouter();
  const [invitation, setInvitation] = useState<z.infer<typeof invitationSchema> | null>(null);
  const [error, setError] = useState<string | null>(
    token.length === 0 ? L.invalidInvitation : null,
  );
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const { config } = useAuthProviders();
  useEffect(() => {
    if (token.length === 0) return;
    const c = new AbortController();
    void workflowRequest("invitation", invitationSchema, c.signal, { token })
      .then((result) => {
        if (c.signal.aborted) return;
        if (result.ok) {
          setInvitation(result.data);
          setName(result.data.name);
          setError(null);
        } else setError(authErrorMessage(result.error, L));
      })
      .catch(() => {
        if (!c.signal.aborted) setError(L.networkError);
      });
    return () => c.abort();
  }, [token, L]);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!invitation) return;
    if (password !== confirmation) {
      task.setError(L.passwordMismatch);
      return;
    }
    void task.run(
      () =>
        authClient.signUp.email({
          email: invitation.email,
          name: name.trim(),
          password,
          callbackURL: "/auth/continue",
        }),
      () => router.replace("/auth/verify-email"),
    );
  }
  return (
    <AuthFrame title={L.inviteTitle} description={L.inviteDescription}>
      {error !== null && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {invitation === null && error === null && <p role="status">{L.working}</p>}
      {invitation && (
        <>
          <AuthField label={L.email} type="email" value={invitation.email} readOnly />
          <p className="text-xs text-muted-foreground">
            {L.invitationExpires}:{" "}
            <time dateTime={invitation.expiresAt}>
              {formatAuthDate(invitation.expiresAt, preferences)}
            </time>
          </p>
          {config?.emailPassword === true && (
            <form onSubmit={submit} className="space-y-4">
              <AuthField
                label={L.name}
                autoComplete="name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <AuthField
                label={L.newPassword}
                type="password"
                autoComplete="new-password"
                help={L.passwordHelp}
                minLength={12}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <AuthField
                label={L.confirmPassword}
                type="password"
                autoComplete="new-password"
                minLength={12}
                required
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
              />
              <Button type="submit" disabled={task.busy}>
                {task.busy ? L.working : L.createAccount}
              </Button>
            </form>
          )}
          <div className="space-y-2">
            {config?.providers.map((provider) => (
              <Button
                key={provider.id}
                className="w-full"
                variant="outline"
                disabled={task.busy}
                onClick={() =>
                  void task.run(() =>
                    authClient.signIn.social({
                      provider: provider.id,
                      callbackURL: "/auth/continue",
                    }),
                  )
                }
              >
                {t("flow.signInWithProvider", { provider: provider.name })}
              </Button>
            ))}
          </div>
        </>
      )}
      <AuthFeedback error={task.error} notice={task.notice} />
      <a href="/login" className="text-sm text-action hover:underline">
        {L.backToLogin}
      </a>
    </AuthFrame>
  );
}
