import type { ReactNode } from "react";
import { getServerSettingsMessages } from "@/features/identity/settingsMessages.server";
import { can } from "@/features/permissions/can";
import { createContext } from "@/frontend/context";
import { listDefs, listHiddenBuiltins } from "@/frontend/reads";
import { ImportWizard } from "../ImportWizard";

export async function generateMetadata() {
  const L = await getServerSettingsMessages();
  return { title: L.importer.title };
}

export default async function NewImportPage(): Promise<ReactNode> {
  const L = await getServerSettingsMessages();

  const { actor } = await createContext();
  if (actor === null) {
    return <p className="text-sm text-red-600">{L.requiresAuth}</p>;
  }
  if (!can(actor, "data.import")) {
    return <p className="text-sm text-red-600">{L.importer.requiresImport}</p>;
  }

  const personDefs = await listDefs("person");
  const orgDefs = await listDefs("organization");
  const dealDefs = await listDefs("deal");
  const activityDefs = await listDefs("activity");
  const leadDefs = await listDefs("lead");
  const hidden = await listHiddenBuiltins();
  const hiddenBuiltins = {
    person: [...hidden.person],
    organization: [...hidden.organization],
    deal: [...hidden.deal],
    activity: [...hidden.activity],
    lead: [...hidden.lead],
  };

  return (
    <ImportWizard
      personDefs={personDefs}
      orgDefs={orgDefs}
      dealDefs={dealDefs}
      activityDefs={activityDefs}
      leadDefs={leadDefs}
      hiddenBuiltins={hiddenBuiltins}
    />
  );
}
