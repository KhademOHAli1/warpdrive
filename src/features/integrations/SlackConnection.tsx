"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { ConnectionBadge } from "./ConnectionBadge";
import { ConnectionFacts } from "./ConnectionFacts";
import { INTEGRATIONS } from "./catalog";
import { IntegrationMark } from "./IntegrationMark";
import { useSlackConnection } from "./useSlackConnection";

export interface ServiceConnectionView {
  id: string;
  provider: string;
  accountName: string;
  status: string;
  settings: { channelId?: string; channelName?: string };
  lastCheckedAt: string | null;
  ownerName?: string | null;
  connectedAt?: string;
  scopes?: string[];
}

export function SlackConnection({
  connection,
  isAdmin,
  onReconnect,
}: {
  connection: ServiceConnectionView;
  isAdmin: boolean;
  onReconnect?: () => void;
}) {
  const t = useAppTranslations("integrations");
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const { channels, channelId, setChannelId, pending, message, run } =
    useSlackConnection(connection);
  const slack = INTEGRATIONS.find((item) => item.id === "slack");
  const status =
    connection.status === "revocation-pending"
      ? "needsAttention"
      : connection.status === "disconnected"
        ? "disconnected"
        : (connection.settings.channelId ?? "").length === 0
          ? "finishSetup"
          : "connected";
  return (
    <section className="space-y-5 rounded-xl border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {slack && <IntegrationMark integration={slack} />}
          <div className="min-w-0">
            <h2 className="break-words text-sm font-semibold">
              <bdi>{connection.accountName}</bdi>
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">{t("workspace")}</p>
          </div>
        </div>
        <ConnectionBadge status={status} />
      </div>
      <ConnectionFacts connection={connection} />
      {connection.settings.channelName !== undefined &&
        (!isAdmin || connection.status !== "connected") && (
          <p className="text-xs text-muted-foreground">
            {t("slackChannel")}:{" "}
            <bdi className="font-medium text-foreground">#{connection.settings.channelName}</bdi>
          </p>
        )}
      {connection.status === "disconnected" && isAdmin && onReconnect && (
        <Button type="button" onClick={onReconnect}>
          {t("reconnect")}
        </Button>
      )}
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
                    })) ??
                    (channelId
                      ? [
                          {
                            value: channelId,
                            label:
                              connection.settings.channelName !== undefined
                                ? `#${connection.settings.channelName}`
                                : channelId,
                          },
                        ]
                      : [])
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
              {t("retryRemoval")}
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
          {message === "freshAuthentication" && (
            <a href="/settings/security" className="ms-2 font-medium text-primary underline">
              {t("verifyIdentity")}
            </a>
          )}
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
