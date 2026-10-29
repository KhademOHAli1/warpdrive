import type { ReactNode } from "react";
import { db } from "@/db/client";
import { listSignatures, listTemplatesForSettings } from "@/features/email/emailAuthoringReads";
import { getServerSettingsMessages } from "@/features/identity/settingsMessages.server";
import { createContext } from "@/server/trpc/context";
import { SettingsHeading } from "../SettingsHeading";
import { SettingsPage } from "../SettingsSurface";
import { SignaturesSettingsClient } from "./SignaturesSettingsClient";
import { TemplatesSettingsClient } from "./TemplatesSettingsClient";

export async function generateMetadata() {
  const L = await getServerSettingsMessages();
  return { title: L.emailTemplates };
}

// Email settings: manage templates (own + shared) and signatures. Reads run with the trusted
// actor; the client components call server actions and router.refresh() to re-fetch.
export default async function EmailSettingsPage(): Promise<ReactNode> {
  const L = await getServerSettingsMessages();

  const ctx = await createContext();
  if (ctx.actor === null) return null;
  const signal = AbortSignal.timeout(15_000);
  const [templates, signatures] = await Promise.all([
    listTemplatesForSettings(db, { actor: ctx.actor }, signal),
    listSignatures(db, { actor: ctx.actor }, signal),
  ]);
  const canShare = ctx.actor.flags.has("filter.share");
  return (
    <SettingsPage className="max-w-3xl">
      <SettingsHeading title={L.emailTemplates} description={L._email.description} />
      <TemplatesSettingsClient templates={templates} canShare={canShare} />
      <SignaturesSettingsClient signatures={signatures} />
    </SettingsPage>
  );
}
