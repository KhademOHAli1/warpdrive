"use client";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { authScreensMessagesForLocale } from "../authScreensMessages";
import { authClient } from "../better/client";
import { AuthField } from "./AuthField";
import { AuthFrame } from "./AuthFrame";
import {
  type AuthFlowMessages,
  type VerificationNextStep,
  verificationNextStep,
} from "./authUiModel";
import { AuthFeedback, useAuthAction } from "./useAuthAction";

function flowCopy(mode: "forgot" | "reset" | "verify", L: AuthFlowMessages) {
  if (mode === "forgot")
    return {
      title: L.resetTitle,
      description: L.resetDescription,
      submit: L.sendReset,
      notice: L.resetSent,
    };
  if (mode === "reset")
    return {
      title: L.choosePassword,
      description: L.passwordHelp,
      submit: L.changePassword,
      notice: L.passwordUpdated,
    };
  return {
    title: L.verifyTitle,
    description: L.verifyDescription,
    submit: L.sendVerification,
    notice: L.verificationSent,
  };
}

export function PasswordFlow({
  mode,
  token,
}: {
  mode: "forgot" | "reset" | "verify";
  token?: string;
}) {
  const L = authScreensMessagesForLocale(useLocale()).flow;
  const task = useAuthAction();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [verifiedStep, setVerifiedStep] = useState<VerificationNextStep | null>(null);
  const copy = flowCopy(mode, L);
  const hasToken = token !== undefined && token.length > 0;
  function submit(event: FormEvent) {
    event.preventDefault();
    if (mode === "reset" && password !== confirmation) {
      task.setError(L.passwordMismatch);
      return;
    }
    if (mode === "reset" && !hasToken) {
      task.setError(L.invalidCode);
      return;
    }
    let nextStep: VerificationNextStep | null = null;
    void task.run(
      async () => {
        if (mode === "verify" && hasToken) {
          const result = await authClient.verifyEmail({ query: { token } });
          if (result.error !== null) return result;
          nextStep = verificationNextStep(result.data);
          return nextStep === null ? { error: "INVALID_RESPONSE" } : result;
        }
        return mode === "forgot"
          ? authClient.requestPasswordReset({
              email: email.trim(),
              redirectTo: "/auth/reset-password",
            })
          : mode === "reset"
            ? authClient.resetPassword({ newPassword: password, token })
            : authClient.sendVerificationEmail({
                email: email.trim(),
                callbackURL: "/auth/continue",
              });
      },
      () => {
        setPassword("");
        setConfirmation("");
        setVerifiedStep(nextStep);
        task.setNotice(
          nextStep === "check_new_email"
            ? L.emailChangeCheckInbox
            : nextStep === "sign_in"
              ? L.emailVerifiedSignIn
              : nextStep === "continue"
                ? L.emailVerifiedContinue
                : copy.notice,
        );
      },
    );
  }
  return (
    <AuthFrame title={copy.title} description={copy.description}>
      {!(mode === "verify" && verifiedStep !== null) && (
        <form onSubmit={submit} className="space-y-4">
          {mode !== "reset" && !hasToken && (
            <AuthField
              label={L.email}
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={task.busy}
            />
          )}
          {mode === "reset" && (
            <>
              <AuthField
                label={L.newPassword}
                type="password"
                autoComplete="new-password"
                minLength={12}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={task.busy}
              />
              <AuthField
                label={L.confirmPassword}
                type="password"
                autoComplete="new-password"
                minLength={12}
                required
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                disabled={task.busy}
              />
            </>
          )}
          <Button type="submit" disabled={task.busy || (mode === "reset" && !hasToken)}>
            {task.busy ? L.working : mode === "verify" && hasToken ? L.confirmEmail : copy.submit}
          </Button>
        </form>
      )}
      <AuthFeedback error={task.error} notice={task.notice} />
      {mode === "verify" && task.error === L.invalidVerification && (
        <a
          href="/auth/verify-email"
          className="block text-sm text-action underline-offset-4 hover:underline"
        >
          {L.sendVerification}
        </a>
      )}
      {mode === "verify" && task.error === L.verificationAccountMismatch && (
        <Button
          variant="outline"
          disabled={task.busy}
          onClick={() =>
            void task.run(
              () => authClient.signOut(),
              () => window.location.reload(),
            )
          }
        >
          {L.signOutToVerify}
        </Button>
      )}
      {mode === "reset" && !hasToken && (
        <p role="alert" className="text-sm text-destructive">
          {L.invalidCode}
        </p>
      )}
      {mode === "verify" && verifiedStep === "continue" && (
        <a href="/auth/continue" className="block text-sm text-action">
          {L.continueToWorkspace}
        </a>
      )}
      {mode === "verify" && verifiedStep === "sign_in" && (
        <a href="/login" className="block text-sm text-action">
          {L.signIn}
        </a>
      )}
      {verifiedStep !== "sign_in" && (
        <a href="/login" className="text-sm text-action hover:underline">
          {L.backToLogin}
        </a>
      )}
    </AuthFrame>
  );
}
