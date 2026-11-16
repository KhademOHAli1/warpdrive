import type { ReactNode } from "react";
import { PERMISSION_FLAGS } from "@/constants/permissionFlags";
import { getServerSettingsMessages } from "@/features/identity/settingsMessages.server";
import { createContext } from "@/frontend/context";
import { listAssignableUsers, listTeams, listUsers } from "@/frontend/reads";
import { SettingsHeading } from "../SettingsHeading";
import { SettingsPage } from "../SettingsSurface";
import { TeamsClient } from "./TeamsClient";
import { TeamsTable } from "./TeamsTable";

export async function generateMetadata() {
  const L = await getServerSettingsMessages();
  return { title: L.teams };
}

export default async function TeamsPage(): Promise<ReactNode> {
  const L = await getServerSettingsMessages();

  const { actor } = await createContext();
  if (actor === null || (actor.type !== "admin" && !actor.flags.has(PERMISSION_FLAGS.MANAGE))) {
    return <p className="text-sm text-red-600">{L.requiresAdmin}</p>;
  }
  // Two user lists on purpose: the table resolves an already-set manager's NAME (which may be an
  // inactive/soft-deleted user, so it must use the unfiltered list, or the name would show as
  // "None"), while the create-team pickers must only offer users you can actually assign, so they
  // use the isActive-filtered listAssignableUsers.
  const [teams, userRows, assignableUsers] = await Promise.all([
    listTeams(),
    listUsers(),
    listAssignableUsers(),
  ]);
  const users = userRows.map((u) => ({ id: u.id, name: u.name }));
  const teamRows = teams.map((t) => ({ id: t.id, name: t.name, managerId: t.managerId }));
  return (
    <SettingsPage>
      <SettingsHeading
        scope="workspace"
        title={L.teams}
        description={L.teamsDescription}
        actions={<TeamsClient users={assignableUsers} />}
      />
      <TeamsTable teams={teamRows} users={users} />
    </SettingsPage>
  );
}
