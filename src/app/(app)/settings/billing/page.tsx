import type { ReactNode } from "react";
import { billingMessagesForLocale } from "@/features/billing/messages";
import { BillingSettingsClient } from "@/features/billing/ui/BillingSettingsClient";
import { getLocalePreferences } from "@/features/i18n/server";
import { createContext, getFrontendConfig } from "@/frontend/context";
import { coreClient } from "@/frontend/trpc";
import { SettingsHeading } from "../SettingsHeading";
import { SettingsPage } from "../SettingsSurface";

export async function generateMetadata() {
  const { locale } = await getLocalePreferences();
  return { title: billingMessagesForLocale(locale).title };
}

export default async function BillingSettingsPage(): Promise<ReactNode> {
  const env = await getFrontendConfig();
  const preferences = await getLocalePreferences();
  const messages = billingMessagesForLocale(preferences.locale);
  const { actor } = await createContext();
  if (actor === null || actor.type !== "admin") {
    return (
      <SettingsPage>
        <SettingsHeading scope="workspace" title={messages.title} />
        <p className="text-sm text-destructive">{messages.adminOnly}</p>
      </SettingsPage>
    );
  }

  const config = await coreClient().frontend.billingConfiguration.query();
  const enabled = env.BILLING_ENABLED === "true" && config !== null;
  return (
    <SettingsPage className="max-w-5xl">
      <SettingsHeading
        scope="workspace"
        title={messages.title}
        description={messages.description}
      />
      <BillingSettingsClient
        enabled={enabled}
        includedSeats={config?.includedSeats ?? 0}
        allowedCountries={config === null ? [] : Array.from(config.allowedCountries)}
      />
    </SettingsPage>
  );
}
