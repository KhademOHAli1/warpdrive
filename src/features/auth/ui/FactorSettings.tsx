"use client";
import { useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/Button";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { authScreensMessagesForLocale } from "../authScreensMessages";
import { authClient } from "../better/client";
import type { SecurityStatus } from "../better/contracts";
import { AuthField } from "./AuthField";
import { ConfirmSecurityAction } from "./ConfirmSecurityAction";
import { MfaPanel } from "./MfaPanel";
import { RecoveryCodes } from "./RecoveryCodes";
import { SecurityPanel } from "./SecuritySurface";
import { AuthFeedback, useAuthAction } from "./useAuthAction";

export function FactorSettings({
  status,
  refresh,
  allowPasskeys = true,
  embedded = false,
}: {
  status: SecurityStatus;
  refresh: () => void;
  allowPasskeys?: boolean;
  embedded?: boolean;
}) {
  const L = authScreensMessagesForLocale(useLocale()).flow;
  const task = useAuthAction();
  const [password, setPassword] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [confirm, setConfirm] = useState(false);
  async function regenerate() {
    await task.run(async () => {
      const result = await authClient.twoFactor.generateBackupCodes(
        status.hasPassword ? { password } : {},
      );
      if (result.error) return result;
      const parsed = z.object({ backupCodes: z.array(z.string()) }).safeParse(result.data);
      if (!parsed.success) return { error: "INVALID_RESPONSE" };
      setCodes(parsed.data.backupCodes);
      setPassword("");
      return result;
    });
  }
  return (
    <SecurityPanel
      title={L.mfaSettingsTitle}
      description={status.needsEnrollment ? L.mfaRequired : undefined}
      embedded={embedded}
    >
      <p className="text-sm">{status.twoFactorEnabled ? L.mfaEnabled : L.mfaDisabled}</p>
      {codes ? (
        <RecoveryCodes
          codes={codes}
          onContinue={() => {
            setCodes(null);
            refresh();
          }}
        />
      ) : !status.twoFactorEnabled ? (
        <MfaPanel
          allowPasskeys={allowPasskeys}
          mode="enroll"
          hasPassword={status.hasPassword}
          onComplete={refresh}
        />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {status.recoveryCodesAvailable ? L.recoveryReady : L.recoveryMissing}
          </p>
          {status.hasPassword && (
            <AuthField
              label={L.currentPassword}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={task.busy || (status.hasPassword && !password)}
              onClick={() => void regenerate()}
            >
              {L.regenerateCodes}
            </Button>
            <Button
              variant="ghost"
              disabled={task.busy || (status.hasPassword && !password)}
              onClick={() => setConfirm(true)}
            >
              {L.disableMfa}
            </Button>
          </div>
        </>
      )}
      <ConfirmSecurityAction
        open={confirm}
        setOpen={setConfirm}
        onConfirm={() =>
          void task.run(
            () => authClient.twoFactor.disable(status.hasPassword ? { password } : {}),
            () => {
              setPassword("");
              refresh();
            },
          )
        }
      />
      <AuthFeedback error={task.error} notice={task.notice} />
    </SecurityPanel>
  );
}
