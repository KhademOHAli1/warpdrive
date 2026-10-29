import Link from "next/link";
import type { ReactNode } from "react";
import { getServerSettingsMessages } from "@/features/identity/settingsMessages.server";
import { can } from "@/features/permissions/can";
import { createContext } from "@/server/trpc/context";
import { SettingsHeading } from "../SettingsHeading";
import { SettingsPage } from "../SettingsSurface";
import { ImportHistory } from "./ImportHistory";

export async function generateMetadata() {
  const L = await getServerSettingsMessages();
  return { title: L.importer.title };
}

// Import history (settings section 10): gated on data.import. Lists the actor's past import
// runs; the wizard itself moved to /settings/import/new.
export default async function ImportPage(): Promise<ReactNode> {
  const L = await getServerSettingsMessages();

  const { actor } = await createContext();
  if (actor === null) {
    return <p className="text-sm text-red-600">{L.requiresAuth}</p>;
  }
  if (!can(actor, "data.import")) {
    return <p className="text-sm text-red-600">{L.importer.requiresImport}</p>;
  }
  return (
    <SettingsPage className="max-w-3xl">
      <SettingsHeading
        title={L.importer.title}
        description={L.importer.subtitle}
        actions={
          <Link
            href="/settings/import/new"
            className="rounded-md bg-action px-3 py-1.5 text-sm font-medium text-action-foreground transition-transform hover:opacity-90 active:scale-[0.96]"
          >
            {L.importer.newImport}
          </Link>
        }
      />
      <ImportHistory />
    </SettingsPage>
  );
}
