"use client";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import { authScreensMessagesForLocale } from "../authScreensMessages";
import { authClient } from "../better/client";
import type { SecurityStatus } from "../better/contracts";
import { ConfirmSecurityAction } from "./ConfirmSecurityAction";
import { SecurityPanel } from "./SecuritySurface";
import { useAuthProviders } from "./useAccountStatus";
import { AuthFeedback, useAuthAction } from "./useAuthAction";
import { workflowAction } from "./workflowRequest";

export function MethodSettings({
  accounts,
  refresh,
  embedded = false,
}: {
  accounts: SecurityStatus["accounts"];
  refresh: () => void;
  embedded?: boolean;
}) {
  const L = authScreensMessagesForLocale(useLocale()).flow;
  const t = useAppTranslations("authScreens");
  const task = useAuthAction();
  const { config } = useAuthProviders();
  const [removing, setRemoving] = useState<SecurityStatus["accounts"][number] | null>(null);
  const external = accounts.filter((account) => account.providerId !== "credential");
  return (
    <SecurityPanel title={L.methodsTitle} description={L.methodsDescription} embedded={embedded}>
      {external.length ? (
        <ul className="divide-y">
          {external.map((account) => (
            <li key={account.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <p className="text-sm">
                <bdi>
                  {config?.providers.find((provider) => provider.id === account.providerId)?.name ??
                    L.linkedProvider}
                </bdi>
              </p>
              <Button
                variant="outline"
                size="sm"
                disabled={task.busy}
                onClick={() => setRemoving(account)}
              >
                {L.unlinkProvider}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{L.noProviders}</p>
      )}
      <div className="flex flex-wrap gap-2">
        {config?.providers
          .filter((provider) => !accounts.some((account) => account.providerId === provider.id))
          .map((provider) => (
            <Button
              variant="outline"
              disabled={task.busy}
              key={provider.id}
              onClick={() =>
                void task.run(() =>
                  authClient.linkSocial({
                    provider: provider.id,
                    callbackURL: "/settings/security",
                  }),
                )
              }
            >
              {t("flow.linkWithProvider", { provider: provider.name })}
            </Button>
          ))}
      </div>
      <ConfirmSecurityAction
        open={removing !== null}
        setOpen={(open) => {
          if (!open) setRemoving(null);
        }}
        onConfirm={() => {
          if (removing)
            void task.run(
              (signal) =>
                workflowAction(
                  {
                    action: "unlinkAccount",
                    providerId: removing.providerId,
                    accountId: removing.accountId,
                  },
                  signal,
                ),
              refresh,
            );
        }}
      />
      <AuthFeedback error={task.error} notice={task.notice} />
    </SecurityPanel>
  );
}
