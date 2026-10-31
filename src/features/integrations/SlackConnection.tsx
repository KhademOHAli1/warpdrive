"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { useFormatters } from "@/lib/useFormatters";
import { readCsrfToken } from "@/utils/csrfCookie";
import {
  configureSlackAction,
  disconnectSlackAction,
  slackChannelsAction,
  testSlackAction,
} from "./actions";

export interface ServiceConnectionView {
  id: string;
  provider: string;
  accountName: string;
  status: string;
  settings: { channelId?: string };
  lastCheckedAt: string | null;
}

export function SlackConnection({
  connection,
  isAdmin,
}: {
  connection: ServiceConnectionView;
  isAdmin: boolean;
}) {
  const t = useAppTranslations("integrations");
  const format = useFormatters();
  const router = useRouter();
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [channels, setChannels] = useState<{ id: string; name: string }[] | null>(null);
  const [channelId, setChannelId] = useState(connection.settings.channelId ?? "");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<
    | "checked"
    | "saved"
    | "requestFailed"
    | "freshAuthentication"
    | "forbidden"
    | "revocationPending"
    | null
  >(null);

  function actionError(error: string) {
    setMessage(error === "freshAuthentication" ? "freshAuthentication" : "requestFailed");
  }

  async function run(action: "channels" | "save" | "check" | "disconnect") {
    setPending(true);
    setMessage(null);
    try {
      const csrf = readCsrfToken();
      if (action === "channels") {
        const result = await slackChannelsAction(csrf, connection.id);
        if (result.ok) setChannels(result.value);
        else actionError(result.error);
        return;
      }
      const operations = {
        save: () => configureSlackAction(csrf, { id: connection.id, channelId }),
        check: () => testSlackAction(csrf, connection.id),
        disconnect: () => disconnectSlackAction(csrf, connection.id),
      };
      const result = await operations[action]();
      if (!result.ok) {
        actionError(result.error);
        return;
      }
      if (action === "disconnect" && result.value === false) setMessage("revocationPending");
      if (action === "save") setMessage("saved");
      if (action === "check") setMessage("checked");
      router.refresh();
    } catch {
      setMessage("requestFailed");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="space-y-4 rounded-lg border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">
            <bdi>{t("slackAccountTitle", { account: connection.accountName })}</bdi>
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("workspace")}</p>
        </div>
        <span className="rounded-md bg-muted px-2 py-1 text-xs">
          {t(connection.status === "connected" ? "connected" : "disconnected")}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("lastChecked")}:{" "}
        {connection.lastCheckedAt !== null
          ? format.dateTime(connection.lastCheckedAt)
          : t("neverChecked")}
      </p>
      {isAdmin && connection.status === "connected" && (
        <>
          <div className="space-y-2">
            <p className="text-sm font-medium">{t("slackChannel")}</p>
            <div className="flex flex-wrap gap-2">
              <div className="min-w-0 flex-1">
                <Select
                  ariaLabel={t("slackChannel")}
                  value={channelId}
                  disabled={pending || channels === null}
                  onChange={setChannelId}
                  placeholder={t("chooseChannel")}
                  options={
                    channels?.map((channel) => ({
                      value: channel.id,
                      label: `#${channel.name}`,
                    })) ?? (channelId ? [{ value: channelId, label: channelId }] : [])
                  }
                  triggerClassName="min-h-10"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  void run("channels");
                }}
              >
                {t("loadChannels")}
              </Button>
            </div>
            {channels?.length === 0 && (
              <p className="text-sm text-muted-foreground">{t("noChannels")}</p>
            )}
          </div>
          <div className="flex flex-wrap gap-2 border-t pt-4">
            <Button
              type="button"
              disabled={pending || !channelId || channels === null}
              onClick={() => {
                void run("save");
              }}
            >
              {t("save")}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => {
                void run("check");
              }}
            >
              {t("check")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => setConfirmDisconnect(true)}
            >
              {t("disconnect")}
            </Button>
          </div>
        </>
      )}
      {connection.status === "revocation-pending" && (
        <div className="space-y-3">
          <p role="status" className="text-sm text-muted-foreground">
            {t("revocationPending")}
          </p>
          {isAdmin && (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setConfirmDisconnect(true)}
            >
              {t("disconnect")}
            </Button>
          )}
        </div>
      )}
      {pending && (
        <p role="status" className="text-sm text-muted-foreground">
          {t("busy")}
        </p>
      )}
      {message && (
        <p
          role={message === "checked" || message === "saved" ? "status" : "alert"}
          className="text-sm"
        >
          {t(message)}
        </p>
      )}
      <ConfirmDialog
        open={confirmDisconnect}
        onOpenChange={setConfirmDisconnect}
        title={t("disconnectTitle")}
        description={t("disconnectBody")}
        confirmLabel={t("disconnect")}
        cancelLabel={t("cancel")}
        onConfirm={() => {
          setConfirmDisconnect(false);
          void run("disconnect");
        }}
        destructive
        pending={pending}
      />
    </section>
  );
}
