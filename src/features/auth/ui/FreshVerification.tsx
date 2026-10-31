"use client";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import { authScreensMessagesForLocale } from "../authScreensMessages";
import { authClient } from "../better/client";
import type { SecurityStatus } from "../better/contracts";
import { AuthField } from "./AuthField";
import { normalizeAuthCode, safeAuthDestination } from "./authUiModel";
import { SecurityPanel } from "./SecuritySurface";
import { useAuthProviders } from "./useAccountStatus";
import { AuthFeedback, useAuthAction } from "./useAuthAction";
import { workflowAction } from "./workflowRequest";

const DEFAULT_RETURN_TO = "/settings/security";
const MAX_RETURN_PATH_DECODINGS = 4;

function confirmationCallback(returnTo: string): string {
  let destination = safeAuthDestination(returnTo);
  try {
    let path = new URL(destination, "https://warpdrive.invalid").pathname;
    for (let depth = 0; depth < MAX_RETURN_PATH_DECODINGS && path.includes("%"); depth++)
      path = decodeURIComponent(path);
    if (path.includes("%") || safeAuthDestination(path) !== path) destination = "/pipeline";
  } catch {
    destination = "/pipeline";
  }
  // Keep the existing account-security callback unchanged for current callers.
  return destination === DEFAULT_RETURN_TO
    ? "/auth/continue?returnTo=/settings/security"
    : `/auth/continue?returnTo=${encodeURIComponent(destination)}`;
}

function ProviderDiscovery({
  loading,
  failed,
  retry,
}: {
  loading: boolean;
  failed: boolean;
  retry: () => void;
}) {
  const L = authScreensMessagesForLocale(useLocale()).flow;
  if (failed)
    return (
      <div className="space-y-2">
        <p role="alert" className="text-sm text-destructive">
          {L.networkError}
        </p>
        <Button variant="outline" onClick={retry}>
          {L.retry}
        </Button>
      </div>
    );
  return loading ? (
    <p role="status" className="text-sm text-muted-foreground">
      {L.working}
    </p>
  ) : null;
}

export function FreshVerification({
  status,
  refresh,
  embedded = false,
  returnTo = DEFAULT_RETURN_TO,
}: {
  status: SecurityStatus;
  refresh: () => void;
  embedded?: boolean;
  returnTo?: string;
}) {
  const L = authScreensMessagesForLocale(useLocale()).flow;
  const t = useAppTranslations("authScreens");
  const task = useAuthAction();
  const { config, error: providerError, retry: retryProviders } = useAuthProviders();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const hasStrongFactor = status.twoFactorEnabled || status.passkeys.length > 0;
  const strongRequired = status.user.isAdmin || status.policy.requireMfaForAll || hasStrongFactor;
  const passwordAllowed = !strongRequired || (status.needsEnrollment && !hasStrongFactor);
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
        {config?.providers
          .filter((provider) =>
            status.accounts.some((account) => account.providerId === provider.id),
          )
          .map((provider) => (
            <Button
              variant="outline"
              key={provider.id}
              disabled={task.busy}
              onClick={() =>
                void task.run(() =>
                  authClient.signIn.social({
                    provider: provider.id,
                    callbackURL: confirmationCallback(returnTo),
                  }),
                )
              }
            >
              {t("flow.confirmWithProvider", { provider: provider.name })}
            </Button>
          ))}
      </div>
      <ProviderDiscovery loading={config === null} failed={providerError} retry={retryProviders} />
      <AuthFeedback error={task.error} notice={task.notice} />
    </SecurityPanel>
  );
}
