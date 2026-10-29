"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Combobox, type ComboboxOption } from "@/components/ui/Combobox";
import { addGroupMemberAction, removeGroupMemberAction } from "@/features/identity/actions/groups";
import { settingsIdentityError } from "@/features/identity/settingsMessages";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";
import { readCsrfToken } from "@/utils/csrfCookie";
import { SettingsCard, SettingsCardBody, SettingsCardHeader } from "../../SettingsSurface";

interface Member {
  userId: string;
  name: string;
}

interface AssignableUser {
  id: string;
  name: string;
  avatarUrl: string | null;
}

interface Props {
  groupId: string;
  members: Member[];
  allUsers: AssignableUser[];
}

// Member roster + add/remove for a single visibility group. Mirrors the inline-form
// pattern used by CreateGroupForm/CreateTeamForm: local pending/error state, a server
// action per mutation, router.refresh() to reload the server-loaded roster on success.
export function GroupMembersClient({ groupId, members, allUsers }: Props): React.ReactElement {
  const L = useSettingsMessages();
  const identityErrorMessage = (error: string) => settingsIdentityError(L, error);

  const router = useRouter();
  const [selectedUserId, setSelectedUserId] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const memberIds = new Set(members.map((m) => m.userId));
  const nonMembers = allUsers.filter((u) => !memberIds.has(u.id));

  function handleRemove(userId: string): void {
    setError(null);
    const csrf = readCsrfToken();
    startTransition(async () => {
      const result = await removeGroupMemberAction(csrf, { groupId, userId });
      if (!result.ok) {
        setError(identityErrorMessage(result.error));
        return;
      }
      router.refresh();
    });
  }

  function handleAdd(): void {
    if (selectedUserId === "") return;
    setError(null);
    const csrf = readCsrfToken();
    startTransition(async () => {
      const result = await addGroupMemberAction(csrf, { groupId, userId: selectedUserId });
      if (!result.ok) {
        setError(identityErrorMessage(result.error));
        return;
      }
      setSelectedUserId("");
      router.refresh();
    });
  }

  return (
    <SettingsCard>
      <SettingsCardHeader
        title={L._extra.members}
        description={L._extra.add_or_remove_users_from_this_group}
      />
      <ul className="divide-y">
        {members.length === 0 && (
          <li className="text-sm text-muted-foreground">{L._extra.no_members_yet}</li>
        )}
        {members.map((m) => (
          <li key={m.userId} className="flex items-center justify-between gap-2 px-5 py-3">
            <span className="text-sm">{m.name}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={L._extra.removeUser(m.name)}
              disabled={isPending}
              onClick={() => handleRemove(m.userId)}
              className="text-red-600"
            >
              {L._extra.remove}
            </Button>
          </li>
        ))}
      </ul>

      <SettingsCardBody className="border-t">
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <span className="mb-1 block text-sm font-medium">{L._extra.add_member}</span>
            <Combobox
              ariaLabel={L._extra.add_member}
              value={selectedUserId}
              onChange={setSelectedUserId}
              placeholder={L._extra.select_a_user}
              options={nonMembers.map<ComboboxOption>((u) => ({
                value: u.id,
                label: u.name,
                avatarName: u.name,
                avatarUrl: u.avatarUrl,
              }))}
            />
          </div>
          <Button type="button" disabled={isPending || selectedUserId === ""} onClick={handleAdd}>
            {L._extra.add}
          </Button>
        </div>

        {error !== null && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
      </SettingsCardBody>
    </SettingsCard>
  );
}
