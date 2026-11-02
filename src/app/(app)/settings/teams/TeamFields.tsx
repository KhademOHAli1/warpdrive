"use client";

import { useId } from "react";
import { Input } from "@/components/ui/Input";
import { MultiCombobox } from "@/components/ui/MultiCombobox";
import { Select } from "@/components/ui/Select";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";
import type { TeamDraft, TeamMember, TeamUser } from "./teamDraft";

const MANAGER_NONE_VALUE = "team:manager:none";

export function TeamFields({
  draft,
  users,
  retainedMembers = [],
  pending,
  detailsLocked = false,
  onChange,
}: {
  draft: TeamDraft;
  users: TeamUser[];
  retainedMembers?: TeamMember[];
  pending: boolean;
  detailsLocked?: boolean;
  onChange: (patch: Partial<TeamDraft>) => void;
}) {
  const L = useSettingsMessages();
  const T = L._identity.teamEditor;
  const nameId = useId();
  const managerOptions = [
    { value: MANAGER_NONE_VALUE, label: T.managerNone },
    ...users.map((user) => ({ value: user.id, label: user.name })),
  ];
  if (draft.managerId !== null && !users.some((user) => user.id === draft.managerId)) {
    managerOptions.push({
      value: draft.managerId,
      label:
        retainedMembers.find((member) => member.userId === draft.managerId)?.name ??
        T.currentManager,
    });
  }
  const members = new Map(
    users.map((user) => [
      user.id,
      { value: user.id, label: user.name, avatarName: user.name, avatarUrl: user.avatarUrl },
    ]),
  );
  for (const member of retainedMembers) {
    if (!members.has(member.userId))
      members.set(member.userId, {
        value: member.userId,
        label: member.name,
        avatarName: member.name,
        avatarUrl: undefined,
      });
  }

  return (
    <div className="space-y-5">
      <fieldset disabled={pending || detailsLocked} className="grid min-w-0 gap-4 sm:grid-cols-2">
        <legend className="sr-only">{L._extra.team_details}</legend>
        <div className="min-w-0 space-y-1.5">
          <label htmlFor={nameId} className="text-sm font-medium">
            {T.nameLabel}
          </label>
          <Input
            id={nameId}
            value={draft.name}
            onChange={(event) => onChange({ name: event.target.value })}
            required
            maxLength={80}
            placeholder={T.namePlaceholder}
          />
        </div>
        <div className="min-w-0 space-y-1.5">
          <span className="text-sm font-medium">{T.manager}</span>
          <Select
            ariaLabel={T.manager}
            value={draft.managerId ?? MANAGER_NONE_VALUE}
            options={managerOptions}
            disabled={pending || detailsLocked}
            onChange={(value) =>
              onChange({ managerId: value === MANAGER_NONE_VALUE ? null : value })
            }
          />
        </div>
      </fieldset>
      <fieldset disabled={pending} className="min-w-0 space-y-2 border-t pt-4">
        <legend className="sr-only">{T.members}</legend>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <span className="text-sm font-medium">{T.members}</span>
            <p className="text-xs text-muted-foreground">{T.membersHelp}</p>
          </div>
          <span className="text-xs tabular-nums text-muted-foreground">
            {L._extra.selectedCount(draft.memberIds.length)}
          </span>
        </div>
        <MultiCombobox
          ariaLabel={T.members}
          values={draft.memberIds}
          options={[...members.values()]}
          placeholder={T.membersPlaceholder}
          onChange={(memberIds) => {
            if (!pending) onChange({ memberIds });
          }}
        />
      </fieldset>
    </div>
  );
}
