"use client";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { authScreensMessagesForLocale } from "../authScreensMessages";
import { authClient } from "../better/client";
import type { SecurityStatus } from "../better/contracts";
import { AuthField } from "./AuthField";
import { SecurityPanel } from "./SecuritySurface";
import { AuthFeedback, useAuthAction } from "./useAuthAction";

export function CredentialSettings({
  status,
  refresh,
  embedded = false,
}: {
  status: SecurityStatus;
  refresh: () => void;
  embedded?: boolean;
}) {
  const L = authScreensMessagesForLocale(useLocale()).flow;
  const task = useAuthAction();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirmation) {
      task.setError(L.passwordMismatch);
      return;
    }
    void task.run(
      () =>
        authClient.changePassword({
          currentPassword: current,
          newPassword: password,
          revokeOtherSessions: true,
        }),
      () => {
        setCurrent("");
        setPassword("");
        setConfirmation("");
        task.setNotice(L.saved);
        refresh();
      },
    );
  }
  return (
    <SecurityPanel title={L.passwordTitle} embedded={embedded}>
      {status.hasPassword ? (
        <form onSubmit={submit} className="space-y-4">
          <AuthField
            label={L.currentPassword}
            type="password"
            autoComplete="current-password"
            required
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
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
            {L.changePassword}
          </Button>
        </form>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{L.noPassword}</p>
          <Button
            variant="outline"
            disabled={task.busy}
            onClick={() =>
              void task.run(
                () =>
                  authClient.requestPasswordReset({
                    email: status.user.email,
                    redirectTo: "/auth/reset-password",
                  }),
                () => task.setNotice(L.resetSent),
              )
            }
          >
            {L.setPassword}
          </Button>
        </>
      )}
      <AuthFeedback error={task.error} notice={task.notice} />
    </SecurityPanel>
  );
}

export function EmailSettings({
  refresh,
  embedded = false,
}: {
  refresh: () => void;
  embedded?: boolean;
}) {
  const L = authScreensMessagesForLocale(useLocale()).flow;
  const task = useAuthAction();
  const [email, setEmail] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    void task.run(
      () =>
        authClient.changeEmail({
          newEmail: email.trim(),
          callbackURL: "/auth/continue?returnTo=/settings/security",
        }),
      () => {
        setEmail("");
        task.setNotice(L.emailChangeSent);
        refresh();
      },
    );
  }
  return (
    <SecurityPanel title={L.emailTitle} description={L.emailChangeDescription} embedded={embedded}>
      <form onSubmit={submit} className="space-y-4">
        <AuthField
          label={L.newEmail}
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Button type="submit" disabled={task.busy}>
          {L.changeEmail}
        </Button>
      </form>
      <AuthFeedback error={task.error} notice={task.notice} />
    </SecurityPanel>
  );
}
