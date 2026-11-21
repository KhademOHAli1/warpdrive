"use client";

import { Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import type { ReleaseRole, ReleaseWorkspace } from "../liveContracts";
import { manufacturingReleaseLiveMessages } from "./manufacturingReleaseLiveMessages";

export function ManufacturingReleasePermissions({
  workspace,
  pending,
  setRequirement,
  setGrant,
}: {
  workspace: ReleaseWorkspace;
  pending: boolean;
  setRequirement: (required: boolean) => void;
  setGrant: (userId: string, role: ReleaseRole | null) => Promise<boolean>;
}) {
  const t = manufacturingReleaseLiveMessages[useLocale()];
  const id = useId();
  const headingId = useId();
  const [member, setMember] = useState("");
  const [role, setRole] = useState<ReleaseRole>("editor");
  const roleNames = { editor: t.engineer, approver: t.approver };

  function changeMember(value: string) {
    setMember(value);
    setRole(workspace.grants.find((grant) => grant.userId === value)?.role ?? "editor");
  }

  return (
    <section aria-labelledby={headingId} className="space-y-3 border-t pt-3">
      <h3 id={headingId} className="text-sm font-semibold">
        {t.permissions}
      </h3>
      <div className="flex items-start justify-between gap-3 rounded-md border bg-muted/20 p-3">
        <div>
          <label htmlFor={id} className="block text-sm font-medium">
            {t.releaseRequired}
          </label>
          <p className="mt-1 text-xs text-muted-foreground">{t.releaseRequiredHelp}</p>
        </div>
        <Switch
          id={id}
          label={t.releaseRequired}
          checked={workspace.releaseRequired}
          onCheckedChange={setRequirement}
          disabled={pending}
        />
      </div>
      {workspace.grants.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.noGrants}</p>
      ) : (
        <ul className="divide-y rounded-md border px-2">
          {workspace.grants.map((grant) => (
            <li key={grant.userId} className="flex items-center justify-between gap-2 py-1.5">
              <div className="min-w-0">
                <bdi className="block break-all text-sm">{grant.name}</bdi>
                <span className="text-xs text-muted-foreground">{roleNames[grant.role]}</span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t.revokeGrant(grant.name)}
                onClick={() => void setGrant(grant.userId, null)}
                disabled={pending}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {workspace.staff.length > 0 && (
        <form
          className="grid items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (member === "") return;
            void setGrant(member, role).then((saved) => {
              if (saved) changeMember("");
            });
          }}
        >
          <div className="grid grid-cols-2 gap-2">
            <div className="grid min-w-0 gap-1">
              <span className="text-xs font-medium">{t.staffMember}</span>
              <Select
                value={member}
                onChange={changeMember}
                options={workspace.staff.map(({ id, name }) => ({ value: id, label: name }))}
                placeholder={t.chooseStaff}
                ariaLabel={t.staffMember}
                contentClassName={BLOCK_CLASS}
                disabled={pending}
              />
            </div>
            <div className="grid min-w-0 gap-1">
              <span className="text-xs font-medium">{t.grantRole}</span>
              <Select
                value={role}
                onChange={(value) => {
                  if (value === "editor" || value === "approver") setRole(value);
                }}
                options={[
                  { value: "editor", label: t.engineer },
                  { value: "approver", label: t.approver },
                ]}
                ariaLabel={t.grantRole}
                contentClassName={BLOCK_CLASS}
                disabled={pending}
              />
            </div>
          </div>
          <Button
            type="submit"
            variant="outline"
            size="sm"
            className="justify-self-start"
            disabled={pending || member === ""}
          >
            {t.saveGrant}
          </Button>
        </form>
      )}
    </section>
  );
}
