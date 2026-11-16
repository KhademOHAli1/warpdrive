import type { ReactNode } from "react";
import { getServerSettingsMessages } from "@/features/identity/settingsMessages.server";
import { createContext } from "@/frontend/context";
import { coreClient } from "@/frontend/trpc";
import { SettingsHeading } from "../SettingsHeading";
import { SettingsPage } from "../SettingsSurface";
import { SignaturesSettingsClient } from "./SignaturesSettingsClient";
import { TemplatesSettingsClient } from "./TemplatesSettingsClient";

export async function generateMetadata() {
  const L = await getServerSettingsMessages();
  return { title: L._hierarchy.emailContent };
}

// Email settings: manage templates (own + shared) and signatures. Reads run with the trusted
// actor; the client components call server actions and router.refresh() to re-fetch.
export default async function EmailSettingsPage(): Promise<ReactNode> {
  const L = await getServerSettingsMessages();

  const ctx = await createContext();
  if (ctx.actor === null) return null;
  const { templates, signatures } = await coreClient().frontend.emailSettings.query();
  const canShare = ctx.actor.type === "admin" || ctx.actor.flags.has("filter.share");
  return (
    <SettingsPage className="max-w-3xl">
      <SettingsHeading
        scope="mixed"
        title={L._hierarchy.emailContent}
        description={L._email.description}
      />
      <TemplatesSettingsClient templates={templates} canShare={canShare} />
      <SignaturesSettingsClient signatures={signatures} />
    </SettingsPage>
  );
}
