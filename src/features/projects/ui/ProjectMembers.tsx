import { type FormEvent, useId, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Select } from "@/components/ui/Select";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import type {
  ProjectMemberGrant,
  ProjectMembership,
  ProjectPerson,
  ProjectResult,
  ProjectWorkspace,
} from "../contracts";
import { InviteProjectGuest } from "../guests/InviteProjectGuest";
import { guestLabels } from "../guests/messages";
import type { ProjectsTranslator } from "./projectMessages";

type MembersProps = {
  workspace: ProjectWorkspace;
  labels: ProjectsTranslator;
  pending: boolean;
  actorId?: string | undefined;
  onGuestInvited?: (person: ProjectPerson) => void;
  setMember: (
    userId: string,
    membership: ProjectMemberGrant | null,
  ) => Promise<ProjectResult<ProjectWorkspace>>;
};

function roleOptions(labels: ProjectsTranslator, guest: string) {
  return [
    { value: "editor", label: labels("members.editor") },
    { value: "viewer", label: labels("members.viewer") },
    { value: "guest", label: guest },
  ];
}

function selectedRole(value: string): ProjectMemberGrant["role"] {
  if (value === "viewer" || value === "guest") return value;
  return "editor";
}

function MemberRow({
  member,
  workspace,
  labels,
  pending,
  setMember,
}: MembersProps & { member: ProjectMembership }) {
  const { person, role, canAssign } = member;
  const { locale } = useLocalePreferences();
  const { guest, pending: invitationPending } = guestLabels[locale];
  const assignmentPermissionId = useId();
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3">
      <bdi className="min-w-0 flex-1 text-sm font-medium [overflow-wrap:anywhere]">
        {person.name}
      </bdi>
      {workspace.canManageMembers ? (
        <div className="flex flex-wrap items-center gap-2.5">
          {member.invitationPending && <Badge variant="outline">{invitationPending}</Badge>}
          {member.projectsGuestOnly ? (
            <Badge variant="secondary">{guest}</Badge>
          ) : (
            <Select
              ariaLabel={labels("members.access", { name: person.name })}
              value={role}
              disabled={pending}
              options={roleOptions(labels, guest)}
              triggerClassName="w-auto min-w-28"
              onChange={(value) => {
                const next = selectedRole(value);
                void setMember(person.id, {
                  role: next,
                  canAssign: next === "editor" && canAssign,
                });
              }}
            />
          )}
          {role === "editor" && (
            <label
              htmlFor={assignmentPermissionId}
              className="flex cursor-pointer items-center gap-1.5 text-sm text-muted-foreground"
            >
              <Checkbox
                id={assignmentPermissionId}
                label={labels("members.allowAssign", { name: person.name })}
                checked={canAssign}
                disabled={pending}
                onCheckedChange={(checked) =>
                  void setMember(person.id, { role, canAssign: checked })
                }
              />
              {labels("members.canAssign")}
            </label>
          )}
          <ConfirmDialog
            title={labels("members.confirmRemove")}
            description={labels("members.removeDescription")}
            confirmLabel={labels("members.confirm")}
            cancelLabel={labels("actions.cancel")}
            destructive
            trigger={
              <Button
                variant="ghost"
                size="sm"
                aria-label={labels("members.remove", { name: person.name })}
                disabled={pending}
              >
                {labels("members.confirm")}
              </Button>
            }
            onConfirm={() => void setMember(person.id, null)}
          />
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{role === "guest" ? guest : labels(`members.${role}`)}</Badge>
          {canAssign && <Badge variant="outline">{labels("members.canAssign")}</Badge>}
        </div>
      )}
    </li>
  );
}

function AddMember({
  staff,
  labels,
  pending,
  setMember,
}: Omit<MembersProps, "workspace"> & { staff: ProjectPerson[] }) {
  const [selected, setSelected] = useState("");
  const [role, setRole] = useState<ProjectMemberGrant["role"]>("editor");
  const { locale } = useLocalePreferences();
  const { guest, memberRole } = guestLabels[locale];
  const userId = staff.some((person) => person.id === selected) ? selected : "";

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || userId === "") return;
    const result = await setMember(userId, { role, canAssign: false });
    if (result.ok) setSelected("");
  }

  return (
    <form onSubmit={(event) => void add(event)} className="flex flex-wrap items-center gap-2">
      <Select
        ariaLabel={labels("members.choose")}
        placeholder={labels("members.choose")}
        value={userId}
        contentClassName={`${BLOCK_CLASS} ph-no-capture`}
        disabled={pending}
        options={staff.map(({ id, name }) => ({ value: id, label: name }))}
        triggerClassName="w-auto min-w-40"
        onChange={setSelected}
      />
      <Select
        ariaLabel={memberRole}
        disabled={pending}
        value={role}
        options={roleOptions(labels, guest)}
        onChange={(value) => setRole(selectedRole(value))}
        triggerClassName="w-auto min-w-28"
      />
      <Button type="submit" disabled={pending || userId === ""}>
        {labels("members.add")}
      </Button>
    </form>
  );
}

export function ProjectMembers(props: MembersProps) {
  const { workspace, labels, actorId, onGuestInvited } = props;
  const { owner } = workspace.project;
  const staff = workspace.staff.filter(
    ({ id }) => id !== owner.id && !workspace.members.some(({ person }) => person.id === id),
  );

  return (
    <div className="space-y-3">
      {workspace.canManageMembers && (
        <div className="flex flex-wrap items-start gap-2">
          {staff.length > 0 && <AddMember staff={staff} {...props} />}
          {actorId !== undefined && onGuestInvited !== undefined && (
            <InviteProjectGuest
              actorId={actorId}
              projectId={workspace.project.id}
              onInvited={onGuestInvited}
            />
          )}
        </div>
      )}
      <ul className="divide-y rounded-lg border bg-card">
        <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <bdi className="min-w-0 text-sm font-medium [overflow-wrap:anywhere]">{owner.name}</bdi>
          <Badge variant="secondary">{labels("members.owner")}</Badge>
        </li>
        {workspace.members.map((member) => (
          <MemberRow key={member.person.id} {...props} member={member} />
        ))}
      </ul>
    </div>
  );
}
