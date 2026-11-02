import type { ReactNode } from "react";
import { env } from "@/config/env";
import { db } from "@/db/client";
import { mailboxConnectionMessages } from "@/features/email/connections/messages";
import { listActorMailboxes } from "@/features/email/mailAccountsRepo";
import { getLocalePreferences } from "@/features/i18n/server";
import { getServerSettingsMessages } from "@/features/identity/settingsMessages.server";
import { createContext } from "@/server/trpc/context";
import { SettingsHeading } from "../SettingsHeading";
import { SettingsPage } from "../SettingsSurface";
import { MailboxConnectionsClient } from "./MailboxConnectionsClient";

export async function generateMetadata() {
  const L = await getServerSettingsMessages();
  return { title: L._emailSync.title };
}

// Keep personal mailbox ownership at the server boundary; credentials never enter page props.
export default async function EmailSyncPage(): Promise<ReactNode> {
  const L = await getServerSettingsMessages();
  const { actor } = await createContext();
  if (actor === null) return <p className="text-sm text-red-600">{L._emailSync.requiresAuth}</p>;
  const preferences = await getLocalePreferences();
  const copy = mailboxConnectionMessages(preferences.locale);
  const mailboxes = await listActorMailboxes(db, actor.id, AbortSignal.timeout(5000));
  const gmailAvailable =
    env.GOOGLE_OAUTH_CLIENT_ID.length > 0 && env.GOOGLE_OAUTH_CLIENT_SECRET.length > 0;
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
