import { type FormEvent, useId, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Select } from "@/components/ui/Select";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import type {
  ProjectMemberGrant,
  ProjectMembership,
  ProjectPerson,
  ProjectResult,
  ProjectWorkspace,
} from "../contracts";
import type { ProjectsTranslator } from "./projectMessages";

type MembersProps = {
  workspace: ProjectWorkspace;
  labels: ProjectsTranslator;
  pending: boolean;
  setMember: (
    userId: string,
    membership: ProjectMemberGrant | null,
  ) => Promise<ProjectResult<ProjectWorkspace>>;
};

function MemberRow({
  member,
  workspace,
  labels,
  pending,
  setMember,
}: MembersProps & { member: ProjectMembership }) {
  const { person, role, canAssign } = member;
  const assignmentPermissionId = useId();
  const roles = [
    { value: "editor", label: labels("members.editor") },
    { value: "viewer", label: labels("members.viewer") },
  ];
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3">
      <bdi className="min-w-0 flex-1 text-sm font-medium [overflow-wrap:anywhere]">
        {person.name}
      </bdi>
      {workspace.canManageMembers ? (
        <div className="flex flex-wrap items-center gap-2.5">
          <Select
            ariaLabel={labels("members.access", { name: person.name })}
            value={role}
            disabled={pending}
            options={roles}
            triggerClassName="w-auto min-w-28"
            onChange={(value) => {
              const next = value === "viewer" ? "viewer" : "editor";
              void setMember(person.id, { role: next, canAssign: next === "editor" && canAssign });
            }}
          />
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
          <Badge variant="secondary">{labels(`members.${role}`)}</Badge>
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
  const userId = staff.some((person) => person.id === selected) ? selected : "";

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || userId === "") return;
    const result = await setMember(userId, { role: "editor", canAssign: false });
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
      <Button type="submit" disabled={pending || userId === ""}>
        {labels("members.add")}
      </Button>
    </form>
  );
}

export function ProjectMembers(props: MembersProps) {
  const { workspace, labels } = props;
  const { owner } = workspace.project;
  const staff = workspace.staff.filter(
    ({ id }) => id !== owner.id && !workspace.members.some(({ person }) => person.id === id),
  );

  return (
    <div className="space-y-3">
      {workspace.canManageMembers && staff.length > 0 && <AddMember staff={staff} {...props} />}
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
