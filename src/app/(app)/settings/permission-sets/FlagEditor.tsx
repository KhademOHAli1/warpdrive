"use client";

import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import type { PermissionFlagKey } from "@/constants/permissionFlags";
import { updateFlagsAction } from "@/features/identity/actions/permission-sets";
import { IdentityActionError } from "@/features/identity/IdentityActionError";
import {
  settingsIdentityError,
  settingsPermissionLabel,
} from "@/features/identity/settingsMessages";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";
import { cn } from "@/lib/utils";
import { readCsrfToken } from "@/utils/csrfCookie";
import { PermissionFlagGroups } from "./PermissionFlagGroups";
import styles from "./PermissionFlagGroups.module.css";
import {
  changedPermissionFlags,
  completePermissionFlags,
  type PermissionFlagMap,
} from "./permissionSetFlags";

interface Props {
  setId: string;
  name: string;
  flags: PermissionFlagMap;
  onSaved: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onPendingChange?: (pending: boolean) => void;
}

export interface FlagEditorHandle {
  save: () => Promise<boolean>;
}

export const FlagEditor = forwardRef<FlagEditorHandle, Props>(function FlagEditor(
  { setId, name, flags, onSaved, onDirtyChange, onPendingChange },
  ref,
) {
  const L = useSettingsMessages();
  const T = L._identity.flagEditor;
  const [saved, setSaved] = useState(() => completePermissionFlags(flags));
  const [current, setCurrent] = useState(saved);
  const [isPending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState(false);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const changed = changedPermissionFlags(current, saved);
  const dirty = changed.length > 0;

  function toggle(key: PermissionFlagKey): void {
    const next = { ...current, [key]: !current[key] };
    setCurrent(next);
    setStatus(false);
    setError(null);
    onDirtyChange?.(changedPermissionFlags(next, saved).length > 0);
  }

  function reset(): void {
    setCurrent(saved);
    setError(null);
    setStatus(false);
    onDirtyChange?.(false);
  }

  async function persist(): Promise<boolean> {
    setError(null);
    setStatus(false);
    setPending(true);
    onPendingChange?.(true);
    try {
      const result = await updateFlagsAction(readCsrfToken(), { setId, flags: current });
      if (!result.ok) {
        setError(settingsIdentityError(L, result.error));
        return false;
      }
      setSaved(current);
      setStatus(true);
      onDirtyChange?.(false);
      onSaved();
      return true;
    } catch {
      setError(L._errors.generic);
      return false;
    } finally {
      inFlight.current = null;
      setPending(false);
      onPendingChange?.(false);
    }
  }

  function save(): Promise<boolean> {
    if (inFlight.current !== null) return inFlight.current;
    if (!dirty) return Promise.resolve(true);
    const task = persist();
    inFlight.current = task;
    return task;
  }

  useImperativeHandle(ref, () => ({ save }));

  return (
    <div className={cn("overflow-hidden rounded-lg border bg-card shadow-sm", styles.container)}>
      <div className="border-b px-5 py-4">
        <h3 className="break-words text-base font-semibold">{name}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{L._hierarchy.permissionScopeHelp}</p>
      </div>
      <div className="p-5">
        <PermissionFlagGroups current={current} isPending={isPending} toggle={toggle} />
        {dirty && (
          <details className="mt-5 rounded-md border bg-muted/20 p-3 text-sm">
            <summary className="cursor-pointer font-medium">
              {L._hierarchy.permissionReview}
            </summary>
            <ul className="mt-3 space-y-1 text-muted-foreground">
              {changed.map((key) => (
                <li key={key}>
                  {settingsPermissionLabel(L, key)}:{" "}
                  {current[key]
                    ? L._hierarchy.permissionAllowed
                    : L._hierarchy.permissionNotAllowed}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/20 px-5 py-3">
        <p className="text-sm text-muted-foreground">
          {dirty ? L._hierarchy.unsavedChanges : L._hierarchy.noPendingChanges}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={reset} disabled={!dirty || isPending}>
            {L.cancel}
          </Button>
          <Button type="button" onClick={() => void save()} disabled={!dirty || isPending}>
            {isPending ? T.saving : T.save}
          </Button>
        </div>
      </div>
      {status && (
        <p role="status" className="px-5 pb-3 text-sm text-success">
          {L.saved}
        </p>
      )}
      {error !== null && <IdentityActionError message={error} className="px-5 pb-3 text-sm" />}
    </div>
  );
});
