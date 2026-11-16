import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { PERMISSION_FLAGS } from "@/constants/permissionFlags";
import { getServerSettingsMessages } from "@/features/identity/settingsMessages.server";
import { createContext } from "@/frontend/context";
import { listAssignableUsers, listTeamMembers, listTeams } from "@/frontend/reads";
import { SettingsHeading } from "../../SettingsHeading";
import { SettingsPage } from "../../SettingsSurface";
import { TeamEditClient } from "./TeamEditClient";

export async function generateMetadata() {
  const L = await getServerSettingsMessages();
  return { title: L.teams };
}

export default async function TeamDetailPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}): Promise<ReactNode> {
  const L = await getServerSettingsMessages();

  const { teamId } = await params;
  const { actor } = await createContext();
  if (actor === null || (actor.type !== "admin" && !actor.flags.has(PERMISSION_FLAGS.MANAGE))) {
    return <p className="text-sm text-red-600">{L.requiresAdmin}</p>;
  }

  const teams = await listTeams();
  const team = teams.find((t) => t.id === teamId);
  if (team === undefined) notFound();

  const [members, assignableUsers] = await Promise.all([
    listTeamMembers(teamId),
    listAssignableUsers(),
  ]);

  return (
    <SettingsPage>
      <Link
        href="/settings/teams"
        className="text-sm text-primary underline-offset-4 hover:underline"
      >
        <span aria-hidden="true" className="inline-block rtl:rotate-180">
          ←
        </span>{" "}
        {L.teams}
      </Link>
      <SettingsHeading
        scope="workspace"
        title={team.name}
        description={L._extra.update_the_team_manager_and_membership}
      />
      <TeamEditClient
        teamId={teamId}
        name={team.name}
        managerId={team.managerId}
        members={members}
        assignableUsers={assignableUsers}
      />
    </SettingsPage>
  );
}
