"use client";
import {
  Fingerprint,
  KeyRound,
  Link2,
  Mail,
  ShieldCheck,
  UserRound,
  UserRoundX,
} from "lucide-react";
import { useId, useState } from "react";
import { SettingsHeading } from "@/app/(app)/settings/SettingsHeading";
import {
  SettingsCard,
  SettingsCardBody,
  SettingsCardHeader,
  SettingsPage,
} from "@/app/(app)/settings/SettingsSurface";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/Textarea";
import { useLocale, useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { authScreensMessagesForLocale } from "../authScreensMessages";
import type { AuthProviders, SecurityStatus } from "../better/contracts";
import { authEventLabel, formatAuthDate } from "./authUiModel";
import { CredentialSettings, EmailSettings } from "./CredentialSettings";
import { FactorSettings } from "./FactorSettings";
import { FreshVerification } from "./FreshVerification";
import { MethodSettings } from "./MethodSettings";
import { PasskeySettings } from "./PasskeySettings";
import { SecurityAction, SecurityPanel } from "./SecuritySurface";
import { SessionSettings } from "./SessionSettings";
import { useAccountStatus, useAuthProviders } from "./useAccountStatus";
import { AuthFeedback, useAuthAction } from "./useAuthAction";
import { workflowAction } from "./workflowRequest";

function ClosureSettings() {
  const id = useId();
  const L = authScreensMessagesForLocale(useLocale()).flow;
  const task = useAuthAction();
  const [reason, setReason] = useState("");
  return (
    <SecurityPanel title={L.closureTitle} embedded>
      <label htmlFor={id} className="block space-y-1.5">
        <span className="text-sm font-medium">{L.closureReason}</span>
        <Textarea
          id={id}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={2000}
        />
      </label>
      <Button
        variant="outline"
        disabled={task.busy || !reason.trim()}
        onClick={() =>
          void task.run(
            (signal) => workflowAction({ action: "requestClosure", reason: reason.trim() }, signal),
            () => {
              setReason("");
              task.setNotice(L.closureRequested);
            },
          )
        }
      >
        {L.requestClosure}
      </Button>
      <AuthFeedback error={task.error} notice={task.notice} />
    </SecurityPanel>
  );
}

function SecurityActivity({ status }: { status: SecurityStatus }) {
  const preferences = useLocalePreferences();
  const L = authScreensMessagesForLocale(useLocale()).flow;
  const [open, setOpen] = useState(false);
  const events = (limit?: number) =>
    status.audit.length ? (
      <ul className="divide-y">
        {status.audit.slice(0, limit).map((event) => (
          <li
            className="flex flex-wrap items-start justify-between gap-2 py-3 first:pt-0 last:pb-0"
            key={event.id}
          >
            <span className="text-sm">
              {authEventLabel(event.action, L)}{" "}
              <span
                className={
                  event.outcome === "success" ? "text-muted-foreground" : "text-destructive"
                }
              >
                · {event.outcome === "success" ? L.securitySuccess : L.securityFailure}
              </span>
            </span>
            <time dateTime={event.createdAt} className="text-xs leading-5 text-muted-foreground">
              {formatAuthDate(event.createdAt, preferences)}
            </time>
          </li>
        ))}
      </ul>
    ) : (
      <p className="text-sm text-muted-foreground">{L.noActivity}</p>
    );
  return (
    <SettingsCard>
      <SettingsCardHeader
        title={L.auditTitle}
        actions={
          status.audit.length > 3 ? (
            <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
              {L.viewActivity}
            </Button>
          ) : undefined
        }
      />
      <SettingsCardBody>{events(3)}</SettingsCardBody>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className={`${BLOCK_CLASS} ph-no-capture max-h-[85dvh] overflow-y-auto`}>
          <DialogHeader>
            <DialogTitle>{L.auditTitle}</DialogTitle>
            <DialogDescription>{L.securityDescription}</DialogDescription>
          </DialogHeader>
          {events()}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">{L.close}</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsCard>
  );
}

function SignInSettings({
  status,
  refresh,
  config,
}: {
  status: SecurityStatus;
  refresh: () => void;
  config: AuthProviders | null;
}) {
  const L = authScreensMessagesForLocale(useLocale()).flow;
  return (
    <SettingsCard>
      <SettingsCardHeader title={L.signInGroup} description={L.signInGroupDescription} />
      <div className="divide-y">
        {config?.emailPassword === true && (
          <SecurityAction
            icon={KeyRound}
            title={L.passwordTitle}
            description={L.passwordRowDescription}
            state={status.hasPassword ? L.configured : L.notConfigured}
            positive={status.hasPassword}
            action={status.hasPassword ? L.changePassword : L.setPassword}
          >
            <CredentialSettings status={status} refresh={refresh} embedded />
          </SecurityAction>
        )}
        {config?.passkeys === true && (
          <SecurityAction
            icon={Fingerprint}
            title={L.passkeysTitle}
            description={L.passkeyRowDescription}
            state={status.passkeys.length ? L.configured : L.notConfigured}
            positive={status.passkeys.length > 0}
            action={L.manage}
          >
            <PasskeySettings passkeys={status.passkeys} refresh={refresh} embedded />
          </SecurityAction>
        )}
        <SecurityAction
          icon={ShieldCheck}
          title={L.mfaSettingsTitle}
          description={L.authenticatorRowDescription}
          state={status.twoFactorEnabled ? L.configured : L.notConfigured}
          positive={status.twoFactorEnabled}
          action={L.manage}
        >
          <FactorSettings allowPasskeys={false} status={status} refresh={refresh} embedded />
        </SecurityAction>
      </div>
    </SettingsCard>
  );
}

function AccountSettings({
  status,
  refresh,
  config,
}: {
  status: SecurityStatus;
  refresh: () => void;
  config: AuthProviders | null;
}) {
  const L = authScreensMessagesForLocale(useLocale()).flow;
  return (
    <SettingsCard>
      <SettingsCardHeader title={L.accountGroup} />
      <div className="divide-y">
        <SecurityAction
          icon={Mail}
          title={L.emailTitle}
          description={L.accountEmailDescription}
          action={L.changeEmail}
        >
          <EmailSettings refresh={refresh} embedded />
        </SecurityAction>
        {(config?.providers.length ?? 0) > 0 ||
        status.accounts.some((account) => account.providerId !== "credential") ? (
          <SecurityAction
            icon={Link2}
            title={L.methodsTitle}
            description={L.methodsDescription}
            action={L.manage}
          >
            <MethodSettings accounts={status.accounts} refresh={refresh} embedded />
          </SecurityAction>
        ) : null}
      </div>
    </SettingsCard>
  );
}

export function SecuritySettings({ initial }: { initial?: SecurityStatus }) {
  const { config, error: providerError, retry: retryProviders } = useAuthProviders();
  const L = authScreensMessagesForLocale(useLocale()).flow;
  const { status, error, refresh: reload } = useAccountStatus(initial);
  const refresh = () => void reload(new AbortController().signal);
  return (
    <SettingsPage className={`${BLOCK_CLASS} ph-no-capture max-w-3xl`}>
      <SettingsHeading
        title={L.securityTitle}
        description={L.securityDescription}
        scope="personal"
      />
      {error !== null && (
        <div className="space-y-3">
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
          <Button variant="outline" onClick={refresh}>
            {L.retryStatus}
          </Button>
          <a href="/login" className="block text-sm text-action">
            {L.backToLogin}
          </a>
        </div>
      )}
      {status === null && error === null && <p role="status">{L.loading}</p>}
      {status !== null &&
        (status.needsMfa || status.needsEnrollment ? (
          <SettingsCard>
            <SettingsCardBody>
              <p className="mb-3 text-sm">{L.mfaRequired}</p>
              <a className="text-action" href="/auth/continue">
                {L.continue}
              </a>
            </SettingsCardBody>
          </SettingsCard>
        ) : (
          <>
            <div className="flex items-center gap-4 rounded-lg border bg-card px-5 py-5">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-action/10 text-action">
                <UserRound className="size-5" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{status.user.name}</p>
                <p className="truncate text-sm text-muted-foreground">
                  <bdi>{status.user.email}</bdi>
                </p>
              </div>
              <Badge variant={status.emailVerified ? "success" : "secondary"}>
                {status.emailVerified ? L.verified : L.unverified}
              </Badge>
            </div>
            {!status.fresh && (
              <SettingsCard>
                <SecurityAction
                  icon={ShieldCheck}
                  title={L.confirmIdentity}
                  description={L.confirmDescription}
                  action={L.confirmIdentity}
                >
                  <FreshVerification status={status} refresh={refresh} embedded />
                </SecurityAction>
              </SettingsCard>
            )}
            {providerError && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
                <p role="alert" className="text-sm text-destructive">
                  {L.networkError}
                </p>
                <Button variant="outline" size="sm" onClick={retryProviders}>
                  {L.retry}
                </Button>
              </div>
            )}
            {!config && !providerError && (
              <p className="text-sm text-muted-foreground" role="status">
                {L.working}
              </p>
            )}
            <SignInSettings status={status} refresh={refresh} config={config} />
            <AccountSettings status={status} refresh={refresh} config={config} />
            <SessionSettings sessions={status.sessions} refresh={refresh} />
            <SecurityActivity status={status} />
            <SettingsCard className="bg-transparent shadow-none">
              <SecurityAction
                icon={UserRoundX}
                title={L.closureTitle}
                description={L.closureDescription}
                action={L.requestClosure}
              >
                <ClosureSettings />
              </SecurityAction>
            </SettingsCard>
          </>
        ))}
    </SettingsPage>
  );
}
