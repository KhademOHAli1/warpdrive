"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { SettingsHeading } from "@/app/(app)/settings/SettingsHeading";
import { SettingsCard, SettingsCardBody, SettingsPage } from "@/app/(app)/settings/SettingsSurface";
import { Button, buttonVariants } from "@/components/ui/Button";
import type { SecurityStatus } from "@/features/auth/better/contracts";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { err, type Result } from "@/types/result";
import { privacyRequestMessagesForLocale } from "../privacyRequestMessages";
import { loadOwnPrivacySecurity } from "./loadOwnPrivacySecurity";
import { OwnPrivacyRequestForm } from "./OwnPrivacyRequestForm";

type WorkspaceState = {
  status: SecurityStatus | null | undefined;
  requesterId: string | null;
  changed: boolean;
  unavailable: boolean;
  loading: boolean;
};

export function PersonalPrivacyWorkspace() {
  const L = privacyRequestMessagesForLocale(useLocale());
  const [view, setView] = useState<WorkspaceState>({
    status: undefined,
    requesterId: null,
    changed: false,
    unavailable: false,
    loading: true,
  });
  const current = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const refreshSecurity = useCallback(
    async (caller: AbortSignal): Promise<Result<SecurityStatus | null, "unavailable">> => {
      caller.throwIfAborted();
      current.current?.abort();
      const active = new AbortController();
      current.current = active;
      const request = ++generation.current;
      const signal = AbortSignal.any([caller, active.signal]);
      setView((previous) => ({ ...previous, loading: true }));
      try {
        const result = await loadOwnPrivacySecurity(signal);
        // A superseded result must not authorize the form's explicit retry either.
        signal.throwIfAborted();
        if (request === generation.current) {
          setView((previous) => {
            if (!result.ok) return { ...previous, loading: false, unavailable: true };
            const status = result.value;
            const requesterId = previous.requesterId ?? status?.user.id ?? null;
            return {
              status,
              requesterId,
              changed: previous.changed || (status !== null && requesterId !== status.user.id),
              unavailable: false,
              loading: false,
            };
          });
        }
        return result;
      } catch (cause) {
        if (request === generation.current && !active.signal.aborted)
          setView((previous) => ({ ...previous, loading: false, unavailable: true }));
        if (
          signal.aborted ||
          (typeof cause === "object" &&
            cause !== null &&
            "name" in cause &&
            cause.name === "AbortError")
        )
          throw cause;
        return err("unavailable");
      }
    },
    [],
  );
  const reload = useCallback(() => {
    void refreshSecurity(new AbortController().signal).catch(() => undefined);
  }, [refreshSecurity]);

  useLayoutEffect(() => {
    const initial = new AbortController();
    void Promise.resolve()
      .then(() => {
        if (!initial.signal.aborted) return refreshSecurity(initial.signal);
      })
      .catch(() => undefined);
    const onActive = () => {
      if (document.visibilityState === "visible") reload();
    };
    window.addEventListener("focus", onActive);
    document.addEventListener("visibilitychange", onActive);
    return () => {
      initial.abort();
      current.current?.abort();
      generation.current += 1;
      window.removeEventListener("focus", onActive);
      document.removeEventListener("visibilitychange", onActive);
    };
  }, [refreshSecurity, reload]);

  const security = view.status;
  const needsSecurity =
    !view.changed &&
    security !== undefined &&
    security !== null &&
    (!security.fresh || security.needsEnrollment || security.needsMfa);
  return (
    <SettingsPage className={`${BLOCK_CLASS} ph-no-capture`}>
      <SettingsHeading
        title={L.workspaceTitle}
        description={L.workspaceDescription}
        scope="personal"
      />
      {(view.loading || view.unavailable || security === null || view.changed || needsSecurity) && (
        <SettingsCard>
          <SettingsCardBody className="space-y-3">
            {view.loading && (
              <p role="status" className="text-sm text-muted-foreground">
                {L.workspaceLoading}
              </p>
            )}
            {view.unavailable && (
              <>
                <p role="alert" className="text-sm text-destructive">
                  {L.workspaceUnavailable}
                </p>
                <Button variant="outline" disabled={view.loading} onClick={reload}>
                  {L.workspaceRetry}
                </Button>
              </>
            )}
            {security === null ? (
              <>
                <p className="text-sm">{L.workspaceSignedOut}</p>
                <a
                  className={buttonVariants({ variant: "outline" })}
                  href="/login?returnTo=%2Fsettings%2Fprivacy"
                >
                  {L.workspaceSignIn}
                </a>
              </>
            ) : view.changed ? (
              <>
                <p role="alert" className="text-sm text-destructive">
                  {L.accountChanged}
                </p>
                <a className={buttonVariants({ variant: "outline" })} href="/settings/privacy">
                  {L.workspaceReload}
                </a>
              </>
            ) : null}
            {needsSecurity && (
              <div className="space-y-2">
                <a
                  className={buttonVariants({ variant: "outline" })}
                  href="/settings/security"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {L.workspaceSecurityTab}
                </a>
                <p className="text-sm text-muted-foreground">{L.workspaceSecurityTabHelp}</p>
              </div>
            )}
          </SettingsCardBody>
        </SettingsCard>
      )}
      {security !== undefined && security !== null && !view.changed && (
        <OwnPrivacyRequestForm securityStatus={security} refreshSecurity={refreshSecurity} />
      )}
    </SettingsPage>
  );
}
