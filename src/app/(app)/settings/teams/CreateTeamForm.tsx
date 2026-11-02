"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { IdentityActionError } from "@/features/identity/IdentityActionError";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";
import { TeamFields } from "./TeamFields";
import { emptyTeamDraft, type TeamUser } from "./teamDraft";
import { useTeamCreation } from "./useTeamCreation";

export function CreateTeamForm({
  users,
  onCreated,
  onCancel,
  onPendingChange,
}: {
  users: TeamUser[];
  onCreated: () => void;
  onCancel?: () => void;
  onPendingChange?: (pending: boolean) => void;
}): React.ReactElement {
  const L = useSettingsMessages();
  const T = L._identity.teamEditor;
  const shared = useAppTranslations("sharedUi");
  const [draft, setDraft] = useState(emptyTeamDraft);
  const creation = useTeamCreation(onPendingChange);

  async function submit(): Promise<void> {
    if (await creation.submit(draft)) {
      setDraft(emptyTeamDraft());
      onCreated();
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className="space-y-5"
    >
      {creation.partial && (
        <p role="status" className="rounded-md border bg-muted/30 p-3 text-sm">
          {T.partialCreated}
        </p>
      )}
      <fieldset disabled={creation.uncertain}>
        <legend className="sr-only">{T.createTitle}</legend>
        <TeamFields
          draft={draft}
          users={users}
          pending={creation.pending}
          detailsLocked={creation.created}
          onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
        />
      </fieldset>
      {creation.error !== null && <IdentityActionError message={creation.error} />}
      {creation.pending && (
        <p role="status" className="text-sm text-muted-foreground">
          {creation.created ? L._extra.saving : T.creating}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
        {onCancel !== undefined && (
          <Button variant="outline" disabled={creation.pending} onClick={onCancel}>
            {creation.created || creation.uncertain ? shared("close") : L.cancel}
          </Button>
        )}
        <Button
          type="submit"
          disabled={creation.pending || creation.uncertain || draft.name.trim() === ""}
        >
          {creation.pending ? L._extra.saving : creation.created ? T.saveMembers : T.create}
        </Button>
      </div>
    </form>
  );
}
