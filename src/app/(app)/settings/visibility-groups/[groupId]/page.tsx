import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { PERMISSION_FLAGS } from "@/constants/permissionFlags";
import { getServerSettingsMessages } from "@/features/identity/settingsMessages.server";
import { listAssignableUsers } from "@/features/identity/users.service";
import {
  listGroupMembers,
  listVisibilityGroups,
} from "@/features/identity/visibility-groups.service";
import { createContext } from "@/server/trpc/context";
import { SettingsHeading } from "../../SettingsHeading";
import { SettingsPage } from "../../SettingsSurface";
import { GroupMembersClient } from "./GroupMembersClient";

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
  const { actor, db } = await createContext();
  if (actor === null || (actor.type !== "admin" && !actor.flags.has(PERMISSION_FLAGS.MANAGE))) {
    return <p className="text-sm text-red-600">{L.requiresAdmin}</p>;
  }

  const signal = AbortSignal.timeout(5000);
  const groups = await listVisibilityGroups(db, signal);
  const group = groups.find((g) => g.id === groupId);
  if (group === undefined) notFound();

  const [membersResult, allUsers] = await Promise.all([
    listGroupMembers(db, actor, groupId, signal),
    listAssignableUsers(db, signal),
  ]);
  const members = membersResult.ok ? membersResult.value : [];

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
      <GroupMembersClient groupId={groupId} members={members} allUsers={allUsers} />
    </SettingsPage>
  );
}
