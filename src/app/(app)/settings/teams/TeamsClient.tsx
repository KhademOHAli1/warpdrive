"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";
import { SettingsFormDialog } from "../SettingsFormDialog";
import { CreateTeamForm } from "./CreateTeamForm";
import type { TeamUser } from "./teamDraft";

export function TeamsClient({ users }: { users: TeamUser[] }): React.ReactElement {
  const T = useSettingsMessages()._identity.teamEditor;
  const router = useRouter();
  return (
    <SettingsFormDialog
      title={T.createTitle}
      description={T.createDescription}
      icon={Plus}
      layout="padded"
    >
      {({ close, onPendingChange }) => {
        function finish(): void {
          close();
          router.refresh();
        }
        return (
          <CreateTeamForm
            users={users}
            onCreated={finish}
            onCancel={finish}
            onPendingChange={onPendingChange}
          />
        );
      }}
    </SettingsFormDialog>
  );
}
