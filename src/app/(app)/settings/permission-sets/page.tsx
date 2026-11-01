import type { ReactNode } from "react";
import { PERMISSION_FLAGS } from "@/constants/permissionFlags";
import { listPermissionSets } from "@/features/identity/permission-sets.service";
import { getServerSettingsMessages } from "@/features/identity/settingsMessages.server";
import { createContext } from "@/server/trpc/context";
import { SettingsHeading } from "../SettingsHeading";
import { SettingsPage } from "../SettingsSurface";
import { PermissionSetsClient } from "./PermissionSetsClient";

export async function generateMetadata() {
  const L = await getServerSettingsMessages();
  return { title: L.permissionSets };
}

export default async function PermissionSetsPage(): Promise<ReactNode> {
  const L = await getServerSettingsMessages();

  const { actor, db } = await createContext();
  if (actor === null || (actor.type !== "admin" && !actor.flags.has(PERMISSION_FLAGS.MANAGE))) {
    return <p className="text-sm text-red-600">{L.requiresAdmin}</p>;
  }
  const rows = await listPermissionSets(db, AbortSignal.timeout(5000));
  // Serializable projection for the client editor (flags is a plain JSONB object).
  const sets = rows.map((ps) => ({
    id: ps.id,
    name: ps.name,
    flags: ps.flags,
    isDefault: ps.isDefault,
  }));
  return (
    <SettingsPage className="max-w-4xl">
      <SettingsHeading
        scope="workspace"
        title={L.permissionSets}
        description={L.permissionSetsDescription}
      />
      <PermissionSetsClient sets={sets} />
    </SettingsPage>
  );
}
