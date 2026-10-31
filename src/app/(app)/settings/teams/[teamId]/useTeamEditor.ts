"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import {
  deleteTeamAction,
  setTeamMembersAction,
  updateTeamAction,
} from "@/features/identity/actions/teams";
import { settingsIdentityError } from "@/features/identity/settingsMessages";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";
import { readCsrfToken } from "@/utils/csrfCookie";
import { sameMembers, type TeamDraft } from "../teamDraft";

export function useTeamEditor(teamId: string, initial: TeamDraft) {
  const L = useSettingsMessages();
  const router = useRouter();
  const [draft, setDraft] = useState(initial);
  const [baseline, setBaseline] = useState(initial);
  const [pending, setPending] = useState(false);
  const [partial, setPartial] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = useRef(false);
  const detailsChanged = draft.name !== baseline.name || draft.managerId !== baseline.managerId;
  const dirty = detailsChanged || !sameMembers(draft.memberIds, baseline.memberIds);

  function change(patch: Partial<TeamDraft>): void {
    if (locked.current) return;
    setDraft((current) => ({ ...current, ...patch }));
    setSaved(false);
  }

  function cancel(): void {
    if (locked.current) return;
    setDraft(baseline);
    setPartial(false);
    setSaved(false);
    setError(null);
  }

  async function save(): Promise<void> {
    if (locked.current || draft.name.trim() === "" || (!dirty && !partial)) return;
    locked.current = true;
    setPending(true);
    setError(null);
    setSaved(false);
    const next = { ...draft, name: draft.name.trim() };
    let detailsSaved = partial;
    try {
      if (detailsChanged) {
        const result = await updateTeamAction(readCsrfToken(), {
          teamId,
          name: next.name,
          managerId: next.managerId,
        });
        if (!result.ok) {
          setError(settingsIdentityError(L, result.error));
          return;
        }
        detailsSaved = true;
        // Cancel and retry must respect the details already committed, even if the
        // separately saved roster fails afterward.
        setBaseline((current) => ({ ...current, name: next.name, managerId: next.managerId }));
      }
      const roster = await setTeamMembersAction(readCsrfToken(), {
        teamId,
        userIds: next.memberIds,
      });
      if (!roster.ok) {
        setPartial(detailsSaved);
        setError(settingsIdentityError(L, roster.error));
        return;
      }
      setBaseline(next);
      setDraft(next);
      setPartial(false);
      setSaved(true);
      router.refresh();
    } catch {
      setPartial(detailsSaved);
      setError(L._errors.generic);
    } finally {
      locked.current = false;
      setPending(false);
    }
  }

  async function remove(): Promise<void> {
    if (locked.current) return;
    locked.current = true;
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      const result = await deleteTeamAction(readCsrfToken(), { teamId });
      if (!result.ok) {
        setError(settingsIdentityError(L, result.error));
        return;
      }
      router.push("/settings/teams");
    } catch {
      setError(L._errors.generic);
    } finally {
      locked.current = false;
      setPending(false);
    }
  }

  return {
    draft,
    baseline,
    dirty,
    detailsChanged,
    pending,
    partial,
    saved,
    error,
    change,
    cancel,
    save,
    remove,
  };
}
