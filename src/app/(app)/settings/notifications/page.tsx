"use client";

import { useState } from "react";
import type { NotificationType } from "@/constants/notificationTypes";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";
import { setPreferenceAction } from "@/features/notifications/actions";
import { PreferencesForm } from "@/features/notifications/ui/PreferencesForm";
import { trpc } from "@/lib/trpc-client";
import { readCsrfToken } from "@/utils/csrfCookie";
import { SettingsHeading } from "../SettingsHeading";
import { SettingsCard, SettingsCardHeader, SettingsPage } from "../SettingsSurface";

export default function NotificationSettingsPage() {
  const L = useSettingsMessages();
  const pageTitle = L._extra.notificationPageTitle;
  const loading = L._extra.notificationLoading;
  const saveError = L._extra.notificationSaveError;

  const utils = trpc.useUtils();
  const prefs = trpc.notifications.preferences.useQuery();
  const [error, setError] = useState<string | null>(null);

  async function handleChange(type: NotificationType, next: { inApp: boolean; email: boolean }) {
    setError(null);
    const result = await setPreferenceAction(
      { type, inApp: next.inApp, email: next.email },
      readCsrfToken(),
    );
    if (result.ok) {
      void utils.notifications.preferences.invalidate();
    } else {
      setError(saveError);
    }
  }

  if (!prefs.data) {
    return <p className="text-sm text-muted-foreground">{loading}</p>;
  }

  return (
    <SettingsPage>
      <SettingsHeading title={pageTitle} description={L.notificationsDescription} />
      {error !== null && <p className="mb-4 text-sm text-destructive">{error}</p>}
      <SettingsCard>
        <SettingsCardHeader
          title={L._extra.notification_channels}
          description={L._extra.choose_how_each_kind_of_update_reaches_you}
        />
        <div className="px-5">
          <PreferencesForm
            prefs={prefs.data}
            onChange={(type, next) => void handleChange(type, next)}
          />
        </div>
      </SettingsCard>
    </SettingsPage>
  );
}
