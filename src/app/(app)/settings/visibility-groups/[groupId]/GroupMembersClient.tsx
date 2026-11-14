"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Combobox, type ComboboxOption } from "@/components/ui/Combobox";
import { useMessages } from "@/features/i18n/LocaleProvider";
import { addGroupMemberAction, removeGroupMemberAction } from "@/features/identity/actions/groups";
import { IdentityActionError } from "@/features/identity/IdentityActionError";
import { settingsIdentityError } from "@/features/identity/settingsMessages";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";
import { useIsomorphicLayoutEffect } from "@/lib/useIsomorphicLayoutEffect";
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

// An unknown roster never exposes empty-state copy or membership mutations.
export function GroupMembersUnavailable(): React.ReactElement {
  const L = useSettingsMessages();
  const messages = useMessages();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <SettingsCard>
      <SettingsCardHeader
        title={L._extra.members}
        description={L._extra.add_or_remove_users_from_this_group}
      />
      <SettingsCardBody className="space-y-3">
        <p role="alert" className="text-sm text-destructive">
          {L._extra.visibilityGroupMembersUnavailable}
        </p>
        <Button
          type="button"
          variant="outline"
          disabled={isPending}
          onClick={() => {
            startTransition(() => {
              try {
                router.refresh();
              } catch {
                // Keep the unavailable roster and its retry when refresh cannot start.
              }
            });
          }}
        >
          {messages.boundaries.retry}
        </Button>
      </SettingsCardBody>
    </SettingsCard>
  );
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
  const inFlight = useRef(false);
  const roster = useRef<HTMLUListElement>(null);
  const picker = useRef<HTMLButtonElement>(null);
  const retryButton = useRef<HTMLButtonElement | null>(null);

  useIsomorphicLayoutEffect(() => {
    if (isPending || document.activeElement !== roster.current) return;
    const retry = retryButton.current;
    const destination = retry?.isConnected === true && !retry.disabled ? retry : picker.current;
    destination?.focus({ preventScroll: true });
  }, [isPending]);

  const memberIds = new Set(members.map((m) => m.userId));
  const nonMembers = allUsers.filter((u) => !memberIds.has(u.id));

  function refreshMembers(): void {
    try {
      router.refresh();
    } catch {
      // The mutation was acknowledged; a refresh failure must not report a failed write.
    }
  }

  function beginWrite(button: HTMLButtonElement): void {
    inFlight.current = true;
    retryButton.current = button;
    // Move focus before disabling the buttons, even if pointer activation has already blurred search.
    roster.current?.focus({ preventScroll: true });
    setError(null);
  }

  function handleRemove(userId: string, button: HTMLButtonElement): void {
    if (isPending || inFlight.current) return;
    beginWrite(button);
    const csrf = readCsrfToken();
    startTransition(async () => {
      try {
        const result = await removeGroupMemberAction(csrf, { groupId, userId });
        if (!result.ok) {
          setError(identityErrorMessage(result.error));
          return;
        }
        retryButton.current = null;
        refreshMembers();
      } catch {
        setError(L._errors.generic);
      } finally {
        inFlight.current = false;
      }
    });
  }

  function handleAdd(button: HTMLButtonElement): void {
    if (selectedUserId === "" || isPending || inFlight.current) return;
    beginWrite(button);
    const csrf = readCsrfToken();
    const userId = selectedUserId;
    startTransition(async () => {
      try {
        const result = await addGroupMemberAction(csrf, { groupId, userId });
        if (!result.ok) {
          setError(identityErrorMessage(result.error));
          return;
        }
        retryButton.current = null;
        setSelectedUserId("");
        refreshMembers();
      } catch {
        setError(L._errors.generic);
      } finally {
        inFlight.current = false;
      }
    });
  }

  return (
    <SettingsCard>
      <SettingsCardHeader
        title={L._extra.members}
        description={L._extra.add_or_remove_users_from_this_group}
      />
      <ul
        ref={roster}
        aria-label={L._extra.members}
        tabIndex={-1}
        className="divide-y focus:outline-2 focus:-outline-offset-2 focus:outline-ring"
      >
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
              onClick={(event) => handleRemove(m.userId, event.currentTarget)}
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
              ref={picker}
              ariaLabel={L._extra.add_member}
              disabled={isPending}
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
          <Button
            type="button"
            disabled={isPending || selectedUserId === ""}
            onClick={(event) => handleAdd(event.currentTarget)}
          >
            {L._extra.add}
          </Button>
        </div>

        {error !== null && <IdentityActionError message={error} className="text-sm text-red-600" />}
      </SettingsCardBody>
    </SettingsCard>
  );
}
