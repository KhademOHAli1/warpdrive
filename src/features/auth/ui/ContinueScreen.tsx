"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { authScreensMessagesForLocale } from "../authScreensMessages";
import { AssistedRecovery } from "./AssistedRecovery";
import { AuthFrame } from "./AuthFrame";
import { safeAuthDestination } from "./authUiModel";
import { FreshVerification } from "./FreshVerification";
import { MfaPanel } from "./MfaPanel";
import { useAccountStatus, useAuthProviders } from "./useAccountStatus";

export function ContinueScreen({ returnTo }: { returnTo?: string }) {
  const L = authScreensMessagesForLocale(useLocale()).flow;
  const { status, error, refresh } = useAccountStatus();
  const router = useRouter();
  const { config, error: providerError, retry: retryProviders } = useAuthProviders();
  useEffect(() => {
    if (status?.emailVerified === true && !status.needsMfa && !status.needsEnrollment)
      router.replace(safeAuthDestination(returnTo));
  }, [status, returnTo, router]);
  const title =
    status?.needsEnrollment === true
      ? L.enrollTitle
      : status?.needsMfa === true
        ? L.mfaTitle
        : L.securityTitle;
  return (
    <AuthFrame title={title}>
      {providerError && (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-destructive">
            {L.networkError}
          </p>
          <Button variant="outline" onClick={retryProviders}>
            {L.retry}
          </Button>
        </div>
      )}
      {status?.needsEnrollment === true && !status.fresh && (
        <FreshVerification
          status={status}
          refresh={() => void refresh(new AbortController().signal)}
        />
      )}
      {error !== null && (
        <>
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
          <Button variant="outline" onClick={() => void refresh(new AbortController().signal)}>
            {L.retryStatus}
          </Button>
          <a href="/login" className="block text-sm text-action">
            {L.backToLogin}
          </a>
        </>
      )}
      {status === null && error === null && <p role="status">{L.loading}</p>}
      {status !== null && !status.emailVerified ? (
        <>
          <p>{L.verifyEmailRequired}</p>
          <a href="/auth/verify-email" className="text-action">
            {L.sendVerification}
          </a>
        </>
      ) : status !== null && (status.needsEnrollment || status.needsMfa) ? (
        <MfaPanel
          mode={status.needsEnrollment ? "enroll" : "challenge"}
          hasPassword={status.hasPassword}
          allowPasskeys={config?.passkeys === true}
          onComplete={() => void refresh(new AbortController().signal)}
        />
      ) : status ? (
        <p role="status">{L.working}</p>
      ) : null}
      <a href="/auth/recovery" className="block text-sm text-action">
        {L.accountRecovery}
      </a>
    </AuthFrame>
  );
}

export function MfaScreen({
  recovery = false,
  returnTo,
}: {
  recovery?: boolean;
  returnTo?: string;
}) {
  const L = authScreensMessagesForLocale(useLocale()).flow;
  const router = useRouter();
  const { config, error: providerError, retry: retryProviders } = useAuthProviders();
  return (
    <AuthFrame title={recovery ? L.recoveryCodes : L.mfaTitle}>
      {providerError && (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-destructive">
            {L.networkError}
          </p>
          <Button variant="outline" onClick={retryProviders}>
            {L.retry}
          </Button>
        </div>
      )}
      <MfaPanel
        initialRecovery={recovery}
        allowPasskeys={config?.passkeys === true}
        mode="challenge"
        onComplete={() =>
          router.replace(
            returnTo === undefined
              ? "/auth/continue"
              : `/auth/continue?returnTo=${encodeURIComponent(safeAuthDestination(returnTo))}`,
          )
        }
      />
      {recovery && <AssistedRecovery />}
      <p className="text-xs text-muted-foreground">{L.supportRecovery}</p>
      {!recovery && (
        <a href="/auth/recovery" className="block text-sm text-action">
          {L.accountRecovery}
        </a>
      )}
      <a href="/login" className="text-sm text-action">
        {L.backToLogin}
      </a>
    </AuthFrame>
  );
}
