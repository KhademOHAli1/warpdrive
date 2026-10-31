"use client";

import { Button } from "@/components/ui/Button";
import { useMessages } from "@/features/i18n/LocaleProvider";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";
import { PreferencesForm } from "@/features/notifications/ui/PreferencesForm";
import { trpc } from "@/lib/trpc-client";
import { SettingsHeading } from "../SettingsHeading";
import {
  SettingsCard,
  SettingsCardBody,
  SettingsCardHeader,
  SettingsPage,
} from "../SettingsSurface";
import { usePreferenceChanges } from "./usePreferenceChanges";

export default function NotificationSettingsPage() {
  const L = useSettingsMessages();
  const messages = useMessages();
  const prefs = trpc.notifications.preferences.useQuery();
  const changes = usePreferenceChanges();

  return (
    <SettingsPage>
      <SettingsHeading
        scope="personal"
        title={L._extra.notificationPageTitle}
        description={L.notificationsDescription}
      />
      <SettingsCard>
        <SettingsCardHeader
          title={L._extra.notification_channels}
          description={L._extra.choose_how_each_kind_of_update_reaches_you}
        />
        {prefs.data !== undefined ? (
          <div className="px-5">
            <PreferencesForm
              prefs={{ ...prefs.data, ...changes.pending }}
              feedback={changes.feedback}
              onChange={(type, next) => void changes.save(type, next)}
              onRetry={changes.retry}
            />
          </div>
        ) : (
          <SettingsCardBody>
            {prefs.isError ? (
              <div className="space-y-3">
                <p role="alert" className="text-sm text-destructive">
                  {L._extra.notificationLoadError}
                </p>
                <Button variant="outline" onClick={() => void prefs.refetch()}>
                  {messages.boundaries.retry}
                </Button>
              </div>
            ) : (
              <p role="status" className="text-sm text-muted-foreground">
                {L._extra.notificationLoading}
              </p>
            )}
          </SettingsCardBody>
        )}
      </SettingsCard>
    </SettingsPage>
  );
}
