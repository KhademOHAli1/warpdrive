import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { PERMISSION_FLAGS } from "@/constants/permissionFlags";
import { getServerSettingsMessages } from "@/features/identity/settingsMessages.server";
import { createContext } from "@/frontend/context";
import { listAssignableUsers, listGroupMembers, listVisibilityGroups } from "@/frontend/reads";
import { SettingsHeading } from "../../SettingsHeading";
import { SettingsPage } from "../../SettingsSurface";
import { GroupMembersClient, GroupMembersUnavailable } from "./GroupMembersClient";

export async function generateMetadata() {
  const L = await getServerSettingsMessages();
  return { title: L.visibilityGroups };
}

export default async function GroupDetailPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}): Promise<ReactNode> {
  const L = await getServerSettingsMessages();

  const { groupId } = await params;
  const { actor } = await createContext();
  if (actor === null || (actor.type !== "admin" && !actor.flags.has(PERMISSION_FLAGS.MANAGE))) {
    return <p className="text-sm text-red-600">{L.requiresAdmin}</p>;
  }

  const groups = await listVisibilityGroups();
  const group = groups.find((g) => g.id === groupId);
  if (group === undefined) notFound();

  let rosterData:
    | [
        Awaited<ReturnType<typeof listGroupMembers>>,
        Awaited<ReturnType<typeof listAssignableUsers>>,
      ]
    | undefined;
  try {
    rosterData = await Promise.all([listGroupMembers(groupId), listAssignableUsers()]);
  } catch {
    // The group is known; retain its heading and navigation while the roster is unavailable.
  }
  const roster =
    rosterData?.[0].ok === true ? (
      <GroupMembersClient
        groupId={groupId}
        members={rosterData[0].value}
        allUsers={rosterData[1]}
      />
    ) : (
      <GroupMembersUnavailable />
    );

  return (
    <SettingsPage>
      <Link
        href="/settings/visibility-groups"
        className="text-sm text-primary underline-offset-4 hover:underline"
      >
        <span aria-hidden="true" className="inline-block rtl:rotate-180">
          ←
        </span>{" "}
        {L.visibilityGroups}
      </Link>
      <SettingsHeading
        scope="workspace"
        title={group.name}
        description={L._extra.manage_who_belongs_to_this_visibility_group}
      />
      {roster}
    </SettingsPage>
  );
}
