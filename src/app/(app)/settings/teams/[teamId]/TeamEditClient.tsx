"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/Button";
import { IdentityActionError } from "@/features/identity/IdentityActionError";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";
import {
  SettingsCard,
  SettingsCardBody,
  SettingsCardFooter,
  SettingsCardHeader,
} from "../../SettingsSurface";
import { TeamFields } from "../TeamFields";
import type { TeamMember, TeamUser } from "../teamDraft";
import { useTeamEditor } from "./useTeamEditor";

export function TeamEditClient({
  teamId,
  name,
  managerId,
  members,
  assignableUsers,
}: {
  teamId: string;
  name: string;
  managerId: string | null;
  members: TeamMember[];
  assignableUsers: TeamUser[];
}): React.ReactElement {
  const L = useSettingsMessages();
  const T = L._identity.teamEditor;
  const editor = useTeamEditor(teamId, {
    name,
    managerId,
    memberIds: members.map((member) => member.userId),
  });
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <>
      <SettingsCard>
        <SettingsCardHeader title={L._extra.team_details} description={T.membersHelp} />
        <SettingsCardBody className="space-y-5">
          {editor.partial && (
            <p role="status" className="rounded-md border bg-muted/30 p-3 text-sm">
              {T.partialUpdated}
            </p>
          )}
          <TeamFields
            draft={editor.draft}
            users={assignableUsers}
            retainedMembers={members}
            pending={editor.pending}
            onChange={editor.change}
          />
          {editor.error !== null && <IdentityActionError message={editor.error} />}
          {(editor.pending || editor.saved) && (
            <p role="status" className="text-sm text-muted-foreground">
              {editor.pending ? L._extra.saving : L.saved}
            </p>
          )}
        </SettingsCardBody>
        <SettingsCardFooter className="flex-wrap justify-between gap-3">
          <Button
            variant="outline"
            className="text-destructive"
            disabled={editor.pending}
            aria-label={`${L._extra.delete_team}: ${editor.baseline.name}`}
            onClick={() => setConfirmDelete(true)}
          >
            {L._extra.delete_team}
          </Button>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={editor.pending || (!editor.dirty && !editor.partial)}
              onClick={editor.cancel}
            >
              {L.cancel}
            </Button>
            <Button
              disabled={
                editor.pending ||
                (!editor.dirty && !editor.partial) ||
                editor.draft.name.trim() === ""
              }
              onClick={() => void editor.save()}
            >
              {editor.pending
                ? L._extra.saving
                : editor.partial && !editor.detailsChanged
                  ? T.saveMembers
                  : L._extra.save_changes}
            </Button>
          </div>
        </SettingsCardFooter>
      </SettingsCard>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={T.deleteTitle}
        description={`${T.deleteDescription} (\u2068${editor.baseline.name}\u2069)`}
        confirmLabel={L._extra.delete_team}
        destructive
        pending={editor.pending}
        onConfirm={() => void editor.remove()}
      />
    </>
  );
}
