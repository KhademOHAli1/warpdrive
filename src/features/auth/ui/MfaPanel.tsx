"use client";
import Image from "next/image";
import QRCode from "qrcode";
import { type FormEvent, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/Button";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { authScreensMessagesForLocale } from "../authScreensMessages";
import { authClient } from "../better/client";
import { AuthField } from "./AuthField";
import { type AuthFlowMessages, normalizeAuthCode } from "./authUiModel";
import { RecoveryCodes } from "./RecoveryCodes";
import { AuthFeedback, useAuthAction } from "./useAuthAction";

const enrollmentSchema = z.object({ totpURI: z.string().url(), backupCodes: z.array(z.string()) });

function panelDescription(mode: "enroll" | "challenge", recovery: boolean, L: AuthFlowMessages) {
  if (mode === "enroll") return L.enrollDescription;
  return recovery ? L.recoveryDescription : L.mfaDescription;
}

function EnrollmentInstructions({
  qr,
  uri,
  L,
}: {
  qr: string | null;
  uri: string;
  L: AuthFlowMessages;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm">{L.scanQr}</p>
      {qr !== null && (
        <Image
          unoptimized
          src={qr}
          alt={L.qrAlt}
          width={240}
          height={240}
          className="mx-auto rounded-md bg-white"
        />
      )}
      <p className="text-sm font-medium">{L.setupKey}</p>
      <p dir="ltr" className="break-all rounded-md border p-3 font-mono text-sm">
        {new URL(uri).searchParams.get("secret")}
      </p>
      <p className="text-xs text-muted-foreground">{L.setupKeyPrivate}</p>
    </div>
  );
}

function EnrollmentActions({
  hasPassword,
  password,
  setPassword,
  busy,
  enroll,
  addPasskey,
  L,
  allowPasskeys,
}: {
  hasPassword: boolean;
  password: string;
  setPassword: (value: string) => void;
  busy: boolean;
  enroll: () => void;
  addPasskey: () => void;
  L: AuthFlowMessages;
  allowPasskeys: boolean;
}) {
  return (
    <div className="space-y-4">
      {hasPassword && (
        <AuthField
          label={L.currentPassword}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      )}
      <Button disabled={busy || (hasPassword && password.length === 0)} onClick={enroll}>
        {L.startAuthenticator}
      </Button>
      {allowPasskeys && (
        <Button variant="outline" disabled={busy} onClick={addPasskey}>
          {L.addPasskey}
        </Button>
      )}
    </div>
  );
}

function recoveryCodesFor(show: boolean, enrollment: z.infer<typeof enrollmentSchema> | null) {
  return show ? enrollment : null;
}

export function MfaPanel({
  mode,
  hasPassword = false,
  onComplete,
  initialRecovery = false,
  allowPasskeys = true,
}: {
  mode: "enroll" | "challenge";
  hasPassword?: boolean;
  initialRecovery?: boolean;
  allowPasskeys?: boolean;
  onComplete: () => void;
}) {
  const L = authScreensMessagesForLocale(useLocale()).flow;
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [recovery, setRecovery] = useState(initialRecovery);
  const [enrollment, setEnrollment] = useState<z.infer<typeof enrollmentSchema> | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [showCodes, setShowCodes] = useState(false);
  const task = useAuthAction();
  async function enroll() {
    await task.run(async () => {
      const result = await authClient.twoFactor.enable(hasPassword ? { password } : {});
      if (result.error) return result;
      const parsed = enrollmentSchema.safeParse(result.data);
      if (!parsed.success) return { error: "INVALID_RESPONSE" };
      setEnrollment(parsed.data);
      setPassword("");
      setQr(await QRCode.toDataURL(parsed.data.totpURI, { width: 240, margin: 2 }));
      return { data: parsed.data };
    });
  }
  function verify(event: FormEvent) {
    event.preventDefault();
    void task.run(
      () =>
        recovery
          ? authClient.twoFactor.verifyBackupCode({ code: code.trim() })
          : authClient.twoFactor.verifyTotp({ code: normalizeAuthCode(code) }),
      () => {
        setCode("");
        if (mode === "enroll" && enrollment !== null) setShowCodes(true);
        else onComplete();
      },
    );
  }
  const visibleRecovery = recoveryCodesFor(showCodes, enrollment);
  if (visibleRecovery !== null)
    return (
      <RecoveryCodes
        codes={visibleRecovery.backupCodes}
        onContinue={() => {
          setEnrollment(null);
          setQr(null);
          onComplete();
        }}
      />
    );
  return (
    <section className="space-y-4">
      <p className="text-sm text-muted-foreground">{panelDescription(mode, recovery, L)}</p>
      {mode === "enroll" && !enrollment ? (
        <EnrollmentActions
          allowPasskeys={allowPasskeys}
          hasPassword={hasPassword}
          password={password}
          setPassword={setPassword}
          busy={task.busy}
          enroll={() => void enroll()}
          addPasskey={() =>
            void task.run(
              () => authClient.passkey.addPasskey({ name: L.unnamedPasskey }),
              onComplete,
            )
          }
          L={L}
        />
      ) : (
        <>
          {enrollment && <EnrollmentInstructions qr={qr} uri={enrollment.totpURI} L={L} />}
          <form className="space-y-4" onSubmit={verify}>
            <AuthField
              label={recovery ? L.recoveryCode : L.authenticatorCode}
              autoComplete={recovery ? "off" : "one-time-code"}
              inputMode={recovery ? "text" : "numeric"}
              help={recovery ? undefined : L.codeInputHint}
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={task.busy}
            />
            <Button type="submit" disabled={task.busy}>
              {task.busy ? L.working : L.verifyCode}
            </Button>
          </form>
          {mode === "challenge" && (
            <Button
              variant="ghost"
              onClick={() => {
                setRecovery(!recovery);
                setCode("");
                task.setError(null);
              }}
            >
              {recovery ? L.useAuthenticator : L.useRecovery}
            </Button>
          )}
        </>
      )}
      {mode === "challenge" && allowPasskeys && (
        <Button
          variant="outline"
          disabled={task.busy}
          onClick={() => void task.run(() => authClient.signIn.passkey(), onComplete)}
        >
          {L.confirmWithPasskey}
        </Button>
      )}
      <AuthFeedback error={task.error} notice={task.notice} />
    </section>
  );
}
