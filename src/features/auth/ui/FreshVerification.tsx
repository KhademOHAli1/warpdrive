"use client";
import { type FormEvent, useId, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/Button";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import { authScreensMessagesForLocale } from "../authScreensMessages";
import { authClient } from "../better/client";
import type { SecurityStatus } from "../better/contracts";
import { AuthField } from "./AuthField";
import { normalizeAuthCode } from "./authUiModel";
import { SecurityPanel } from "./SecuritySurface";
import { useAuthProviders } from "./useAccountStatus";
import { AuthFeedback, useAuthAction } from "./useAuthAction";
import { workflowAction } from "./workflowRequest";

export function FreshVerification({
  status,
  refresh,
  embedded = false,
  providerConfirmation = "redirect",
}: {
  status: SecurityStatus;
  refresh: () => void;
  embedded?: boolean;
  providerConfirmation?: "redirect" | "new_tab";
}) {
  const L = authScreensMessagesForLocale(useLocale()).flow;
  const t = useAppTranslations("authScreens");
  const task = useAuthAction();
  const { config } = useAuthProviders();
  const newTabHelpId = useId();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const hasStrongFactor = status.twoFactorEnabled || status.passkeys.length > 0;
  const strongRequired = status.user.isAdmin || status.policy.requireMfaForAll || hasStrongFactor;
  const passwordAllowed = !strongRequired || (status.needsEnrollment && !hasStrongFactor);
  const linkedProviders =
    config?.providers.filter((provider) =>
      status.accounts.some((account) => account.providerId === provider.id),
    ) ?? [];
  function passwordSubmit(event: FormEvent) {
    event.preventDefault();
    void task.run(
      (signal) => workflowAction({ action: "reauthenticate", password }, signal),
      () => {
        setPassword("");
        refresh();
      },
    );
  }
  function factorSubmit(event: FormEvent) {
    event.preventDefault();
    void task.run(
      () => authClient.twoFactor.verifyTotp({ code: normalizeAuthCode(code) }),
      () => {
        setCode("");
        refresh();
      },
    );
  }
  return (
    <SecurityPanel title={L.confirmIdentity} description={L.confirmDescription} embedded={embedded}>
      {status.hasPassword && passwordAllowed && (
        <form className="space-y-3" onSubmit={passwordSubmit}>
          <AuthField
            label={L.currentPassword}
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <Button type="submit" disabled={task.busy}>
            {L.confirmIdentity}
          </Button>
        </form>
      )}
      {status.twoFactorEnabled && (
        <form className="space-y-3" onSubmit={factorSubmit}>
          <AuthField
            label={L.authenticatorCode}
            autoComplete="one-time-code"
            inputMode="numeric"
            required
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
          <Button type="submit" disabled={task.busy}>
            {L.verifyCode}
          </Button>
        </form>
      )}
      <div className="flex flex-wrap gap-2">
        {status.passkeys.length > 0 && config?.passkeys === true && (
          <Button
            variant="outline"
            disabled={task.busy}
            onClick={() => void task.run(() => authClient.signIn.passkey(), refresh)}
          >
            {L.confirmWithPasskey}
          </Button>
        )}
        {providerConfirmation === "new_tab" && linkedProviders.length > 0 ? (
          <div className="space-y-2">
            <a
              href="/settings/security"
              target="_blank"
              rel="noopener noreferrer"
              aria-describedby={newTabHelpId}
              aria-disabled={task.busy}
              tabIndex={task.busy ? -1 : undefined}
              className={buttonVariants({ variant: "outline" })}
              onClick={(event) => {
                if (task.busy) event.preventDefault();
              }}
            >
              {L.confirmIdentityInNewTab}
            </a>
            <p id={newTabHelpId} className="text-sm text-muted-foreground">
              {L.confirmNewTabDescription}
            </p>
          </div>
        ) : (
          linkedProviders.map((provider) => (
            <Button
              variant="outline"
              key={provider.id}
              disabled={task.busy}
              onClick={() =>
                void task.run(() =>
                  authClient.signIn.social({
                    provider: provider.id,
                    callbackURL: "/auth/continue?returnTo=/settings/security",
                  }),
                )
              }
            >
              {t("flow.confirmWithProvider", { provider: provider.name })}
            </Button>
          ))
        )}
      </div>
      <AuthFeedback error={task.error} notice={task.notice} />
    </SecurityPanel>
  );
}
