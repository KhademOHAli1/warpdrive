"use client";
import { CalendarDays } from "lucide-react";
import { useSearchParams } from "next/navigation";
import {
  SettingsCard,
  SettingsCardBody,
  SettingsCardHeader,
} from "@/app/(app)/settings/SettingsSurface";
import { Button } from "@/components/ui/Button";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { trpc } from "@/lib/trpc-client";
import { CalendarConnectionAccount } from "./CalendarConnectionAccount";
import { useCalendarConnection } from "./useCalendarConnection";

const callbackStatuses = ["connected", "denied", "error", "unavailable", "signed_out"] as const;
function callbackMessage(status: string | null) {
  return callbackStatuses.find((allowed) => allowed === status);
}
function ConnectionFeedback({
  feedback,
}: {
  feedback: ReturnType<typeof useCalendarConnection>["feedback"];
}) {
  const t = useAppTranslations("calendar");
  if (feedback === null) return null;
  const success = feedback === "disconnected";
  return (
    <p
      role={success ? "status" : "alert"}
      className={success ? "text-sm text-success" : "text-sm text-destructive"}
    >
      {t(`googleConnection.${feedback}`)}
    </p>
  );
}
export function CalendarConnectionCard(): React.ReactNode {
  const t = useAppTranslations("calendar");
  const query = trpc.calendars.googleAccounts.useQuery(undefined, { staleTime: 0 });
  const connection = useCalendarConnection(async () => {
    const result = await query.refetch({ cancelRefetch: true });
    return !result.isError && result.data !== undefined;
  });
  const callback = callbackMessage(useSearchParams().get("googleConnect"));
  const disabled = connection.pending !== null;
  return (
    <SettingsCard>
      <SettingsCardHeader
        icon={<CalendarDays className="size-4" aria-hidden="true" />}
        title={t("googleConnection.title")}
        description={t("googleConnection.description")}
      />
      <SettingsCardBody className="space-y-4">
        {callback !== undefined && (
          <p role="status" className="text-sm text-muted-foreground">
            {t(`googleConnection.callback.${callback}`)}
          </p>
        )}
        {query.isError ? (
          <div className="space-y-2">
            <p role="alert" className="text-sm text-destructive">
              {t("googleConnection.loadFailed")}
            </p>
            <Button
              variant="outline"
              disabled={disabled}
              onClick={() => {
                void connection.refreshAccounts();
              }}
            >
              {t("editor.retry")}
            </Button>
          </div>
        ) : query.data === undefined ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t("googleConnection.loading")}
          </p>
        ) : (
          <>
            {!query.data.configured && (
              <p className="text-sm text-muted-foreground">{t("googleConnection.unconfigured")}</p>
            )}
            {query.data.accounts.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("googleConnection.empty")}</p>
            ) : (
              <ul className="divide-y">
                {query.data.accounts.map((account) => (
                  <CalendarConnectionAccount
                    key={account.id}
                    account={
                      connection.isLocallyDisconnected(account.id)
                        ? { ...account, status: "disconnected" }
                        : account
                    }
                    configured={query.data.configured}
                    connection={connection}
                  />
                ))}
              </ul>
            )}
            <Button
              variant="outline"
              disabled={disabled || !query.data.configured}
              onClick={() => {
                void connection.connect();
              }}
            >
              {t(
                connection.pending === "new"
                  ? "googleConnection.connecting"
                  : "googleConnection.connect",
              )}
            </Button>
            <p className="text-xs text-muted-foreground">{t("googleConnection.syncUnavailable")}</p>
          </>
        )}
        <ConnectionFeedback feedback={connection.feedback} />
      </SettingsCardBody>
    </SettingsCard>
  );
}
