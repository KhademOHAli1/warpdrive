import type { ReactNode } from "react";
import { mailboxConnectionMessages } from "@/features/email/connections/messages";
import { getLocalePreferences } from "@/features/i18n/server";
import { getServerSettingsMessages } from "@/features/identity/settingsMessages.server";
import { createContext, getFrontendConfig } from "@/frontend/context";
import { listActorMailboxes } from "@/frontend/reads";
import { SettingsHeading } from "../SettingsHeading";
import { SettingsPage } from "../SettingsSurface";
import { MailboxConnectionsClient } from "./MailboxConnectionsClient";

export async function generateMetadata() {
  const L = await getServerSettingsMessages();
  return { title: L._emailSync.title };
}

// Keep personal mailbox ownership at the server boundary; credentials never enter page props.
export default async function EmailSyncPage(): Promise<ReactNode> {
  const env = await getFrontendConfig();
  const L = await getServerSettingsMessages();
  const { actor } = await createContext();
  if (actor === null) return <p className="text-sm text-red-600">{L._emailSync.requiresAuth}</p>;
  const preferences = await getLocalePreferences();
  const copy = mailboxConnectionMessages(preferences.locale);
  const mailboxes = await listActorMailboxes();
  const gmailAvailable = env.GMAIL_CONFIGURED;
  return (
    <SettingsPage>
      <SettingsHeading
        scope="personal"
        title={L._emailSync.title}
        description={copy.settingsDescription}
      />
      <MailboxConnectionsClient initialMailboxes={mailboxes} gmailAvailable={gmailAvailable} />
    </SettingsPage>
  );
}
