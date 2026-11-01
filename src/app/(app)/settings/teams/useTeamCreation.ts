"use client";

import { useRef, useState } from "react";
import { createTeamAction, setTeamMembersAction } from "@/features/identity/actions/teams";
import { settingsIdentityError } from "@/features/identity/settingsMessages";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";
import { readCsrfToken } from "@/utils/csrfCookie";
import type { TeamDraft } from "./teamDraft";

export function useTeamCreation(onPendingChange?: (pending: boolean) => void) {
  const L = useSettingsMessages();
  const checkpoint = useRef<string | null>(null);
  const locked = useRef(false);
  const uncertainOutcome = useRef(false);
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [partial, setPartial] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(draft: TeamDraft): Promise<boolean> {
    if (locked.current || uncertainOutcome.current || draft.name.trim() === "") return false;
    locked.current = true;
    setPending(true);
    onPendingChange?.(true);
    setError(null);
    let phase: "create" | "members" = checkpoint.current === null ? "create" : "members";
    const finishing = checkpoint.current !== null;
    try {
      let teamId = checkpoint.current;
      if (teamId === null) {
        const result = await createTeamAction(readCsrfToken(), {
          name: draft.name.trim(),
          managerId: draft.managerId,
        });
        if (!result.ok) {
          setError(settingsIdentityError(L, result.error));
          return false;
        }
        teamId = result.value.id;
        // Membership is a separate action. Keep the confirmed id so retry never creates
        // a second team after that later action fails.
        checkpoint.current = teamId;
        setCreated(true);
        phase = "members";
      }
      if (draft.memberIds.length > 0 || finishing) {
        const result = await setTeamMembersAction(readCsrfToken(), {
          teamId,
          userIds: draft.memberIds,
        });
        if (!result.ok) {
          setPartial(true);
          setError(settingsIdentityError(L, result.error));
          return false;
        }
      }
      checkpoint.current = null;
      setCreated(false);
      setPartial(false);
      return true;
    } catch {
      if (phase === "create") {
        // Without a returned id or server idempotency key, a transport failure has an
        // unknown commit outcome. Return to the directory instead of blindly creating again.
        uncertainOutcome.current = true;
        setUncertain(true);
        setError(L._identity.teamEditor.creationUnknown);
      } else {
        setPartial(true);
        setError(L._errors.generic);
      }
      return false;
    } finally {
      locked.current = false;
      setPending(false);
      onPendingChange?.(false);
    }
  }

  return { submit, pending, created, partial, uncertain, error };
}
