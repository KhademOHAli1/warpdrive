"use client";
import { Monitor } from "lucide-react";
import {
  SettingsCard,
  SettingsCardBody,
  SettingsCardHeader,
} from "@/app/(app)/settings/SettingsSurface";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useLocale, useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { authScreensMessagesForLocale } from "../authScreensMessages";
import type { SecurityStatus } from "../better/contracts";
import { authDeviceName, formatAuthDate } from "./authUiModel";
import { AuthFeedback, useAuthAction } from "./useAuthAction";
import { workflowAction } from "./workflowRequest";

export function SessionSettings({
  sessions,
  refresh,
}: {
  sessions: SecurityStatus["sessions"];
  refresh: () => void;
}) {
  const locale = useLocale();
  const preferences = useLocalePreferences();
  const L = authScreensMessagesForLocale(locale).flow;
  const task = useAuthAction();
  const date = (value: string) => formatAuthDate(value, preferences);
  const revoke = (action: "revokeSession" | "revokeOthers" | "revokeAll", id?: string) =>
    void task.run(
      (signal) => workflowAction(id !== undefined ? { action, id } : { action }, signal),
      refresh,
    );
  return (
    <SettingsCard>
      <SettingsCardHeader title={L.sessionsTitle} description={L.sessionsDescription} />
      <SettingsCardBody className="space-y-4">
        <ul className="divide-y">
          {sessions.map((session) => (
            <li key={session.id} className="space-y-3 py-4 first:pt-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  <Monitor className="size-4 text-muted-foreground" aria-hidden="true" />
                  <bdi>{authDeviceName(session.userAgent, L.unknownDevice)}</bdi>
                  {session.current && <Badge variant="success">{L.currentDevice}</Badge>}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={task.busy}
                  onClick={() => revoke("revokeSession", session.id)}
                >
                  {L.signOutDevice}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {L.lastSeen}: <time dateTime={session.lastSeenAt}>{date(session.lastSeenAt)}</time>
              </p>
              <details className="text-xs text-muted-foreground">
                <summary className="w-fit cursor-pointer rounded py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {L.deviceDetails}
                </summary>
                <div className="mt-2 space-y-2 rounded-md bg-muted/30 p-3">
                  <p>
                    <bdi>{session.ipAddress ?? L.unknownAddress}</bdi>
                  </p>
                  <p>
                    {L.expires}: <time dateTime={session.expiresAt}>{date(session.expiresAt)}</time>
                  </p>
                  <p className="break-all">
                    <bdi>{session.userAgent ?? L.unknownDevice}</bdi>
                  </p>
                </div>
              </details>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2 border-t pt-4">
          <Button variant="outline" disabled={task.busy} onClick={() => revoke("revokeOthers")}>
            {L.signOutOthers}
          </Button>
          <Button variant="outline" disabled={task.busy} onClick={() => revoke("revokeAll")}>
            {L.signOutAll}
          </Button>
        </div>
        <AuthFeedback error={task.error} notice={task.notice} />
      </SettingsCardBody>
    </SettingsCard>
  );
}
