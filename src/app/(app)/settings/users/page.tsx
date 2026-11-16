import type { ReactNode } from "react";
import { PERMISSION_FLAGS } from "@/constants/permissionFlags";
import { getServerSettingsMessages } from "@/features/identity/settingsMessages.server";
import { createContext } from "@/frontend/context";
import { listPermissionSets, listUsers } from "@/frontend/reads";
import { SettingsHeading } from "../SettingsHeading";
import { SettingsPage } from "../SettingsSurface";
import { UsersClient } from "./UsersClient";

export async function generateMetadata() {
  const L = await getServerSettingsMessages();
  return { title: L.users };
}

export default async function UsersPage(): Promise<ReactNode> {
  const L = await getServerSettingsMessages();

  const { actor } = await createContext();
  if (actor === null || (actor.type !== "admin" && !actor.flags.has(PERMISSION_FLAGS.MANAGE))) {
    return <p className="text-sm text-red-600">{L.requiresAdmin}</p>;
  }
  const [rows, sets] = await Promise.all([listUsers(), listPermissionSets()]);
  const serializable = rows.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    isAdmin: u.isAdmin,
    isActive: u.isActive,
    invitedAt: u.invitedAt === null ? null : u.invitedAt.toISOString(),
    permissionSetId: u.permissionSetId,
  }));
  const setOptions = sets.map((ps) => ({ id: ps.id, name: ps.name }));
  return (
    <SettingsPage>
      <SettingsHeading scope="workspace" title={L.users} description={L.usersDescription} />
      <UsersClient
        rows={serializable}
        permissionSets={setOptions}
        viewerIsAdmin={actor.type === "admin"}
      />
    </SettingsPage>
  );
}
