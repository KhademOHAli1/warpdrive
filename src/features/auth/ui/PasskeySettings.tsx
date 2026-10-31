"use client";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { authScreensMessagesForLocale } from "../authScreensMessages";
import { authClient } from "../better/client";
import type { SecurityStatus } from "../better/contracts";
import { AuthField } from "./AuthField";
import { ConfirmSecurityAction } from "./ConfirmSecurityAction";
import { SecurityPanel } from "./SecuritySurface";
import { AuthFeedback, useAuthAction } from "./useAuthAction";

function PasskeyRow({
  passkey,
  refresh,
}: {
  passkey: SecurityStatus["passkeys"][number];
  refresh: () => void;
}) {
  const L = authScreensMessagesForLocale(useLocale()).flow;
  const task = useAuthAction();
  const [name, setName] = useState(passkey.name ?? "");
  const [confirm, setConfirm] = useState(false);
  return (
    <li className="space-y-3 border-b py-4 last:border-0">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <AuthField
            label={L.passkeyName}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={L.unnamedPasskey}
            maxLength={100}
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={task.busy || !name.trim()}
          onClick={() =>
            void task.run(
              () => authClient.passkey.updatePasskey({ id: passkey.id, name: name.trim() }),
              refresh,
            )
          }
        >
          {L.rename}
        </Button>
        <Button variant="ghost" size="sm" disabled={task.busy} onClick={() => setConfirm(true)}>
          {L.remove}
        </Button>
      </div>
      {passkey.backedUp && <p className="text-xs text-muted-foreground">{L.backedUp}</p>}
      <AuthFeedback error={task.error} notice={task.notice} />
      <ConfirmSecurityAction
        open={confirm}
        setOpen={setConfirm}
        onConfirm={() =>
          void task.run(() => authClient.passkey.deletePasskey({ id: passkey.id }), refresh)
        }
      />
    </li>
  );
}

export function PasskeySettings({
  passkeys,
  refresh,
  embedded = false,
}: {
  passkeys: SecurityStatus["passkeys"];
  refresh: () => void;
  embedded?: boolean;
}) {
  const L = authScreensMessagesForLocale(useLocale()).flow;
  const task = useAuthAction();
  const [name, setName] = useState("");
  return (
    <SecurityPanel title={L.passkeysTitle} description={L.passkeysDescription} embedded={embedded}>
      {passkeys.length ? (
        <ul>
          {passkeys.map((passkey) => (
            <PasskeyRow key={passkey.id} passkey={passkey} refresh={refresh} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{L.noPasskeys}</p>
      )}
      <AuthField
        label={L.passkeyName}
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder={L.unnamedPasskey}
        maxLength={100}
      />
      <Button
        disabled={task.busy}
        onClick={() =>
          void task.run(
            () => authClient.passkey.addPasskey({ name: name.trim() || L.unnamedPasskey }),
            () => {
              setName("");
              refresh();
            },
          )
        }
      >
        {L.addPasskey}
      </Button>
      <AuthFeedback error={task.error} notice={task.notice} />
    </SecurityPanel>
  );
}
