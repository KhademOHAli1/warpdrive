"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";
import { useSyncedState } from "@/lib/useSyncedState";
import { CreatePermissionSetDialog } from "./CreatePermissionSetDialog";
import { FlagEditor, type FlagEditorHandle } from "./FlagEditor";
import { PermissionSetDirectory } from "./PermissionSetDirectory";
import type { PermissionSetRow } from "./types";

export function PermissionSetsClient({ sets }: { sets: PermissionSetRow[] }): React.ReactElement {
  const L = useSettingsMessages();
  const router = useRouter();
  // Keep acknowledged flags when revisiting a role before refreshed server props arrive.
  const [rows, setRows] = useSyncedState(sets);
  const editor = useRef<FlagEditorHandle>(null);
  const [selectedId, setSelectedId] = useState(sets[0]?.id);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [nextId, setNextId] = useState<string | null>(null);
  const selected = rows.find((set) => set.id === selectedId) ?? rows[0];

  function select(id: string): void {
    setSelectedId(id);
    setDirty(false);
  }

  function requestSelection(id: string): void {
    if (pending || selected?.id === id) return;
    if (dirty) setNextId(id);
    else select(id);
  }

  async function saveAndSwitch(): Promise<void> {
    if (nextId === null || pending) return;
    const target = nextId;
    const saved = await editor.current?.save();
    if (saved === true) select(target);
    setNextId(null);
  }

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <CreatePermissionSetDialog disabled={pending} onCreated={() => router.refresh()} />
      </div>
      <PermissionSetDirectory
        sets={rows}
        selectedId={selected?.id}
        pending={pending}
        onSelect={requestSelection}
      />
      {selected === undefined ? (
        <p className="rounded-lg border bg-card p-5 text-sm text-muted-foreground">
          {L._hierarchy.permissionSetEmpty}
        </p>
      ) : (
        <FlagEditor
          key={selected.id}
          ref={editor}
          setId={selected.id}
          name={selected.name}
          flags={selected.flags}
          onSaved={(flags) => {
            setRows((current) =>
              current.map((set) =>
                set.id === selected.id ? { ...set, flags: { ...flags } } : set,
              ),
            );
            router.refresh();
          }}
          onDirtyChange={setDirty}
          onPendingChange={setPending}
        />
      )}
      <ConfirmDialog
        open={nextId !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setNextId(null);
        }}
        title={L._hierarchy.permissionSwitchTitle}
        description={L._hierarchy.permissionSwitchDescription}
        confirmLabel={L._hierarchy.permissionDiscard}
        cancelLabel={L.cancel}
        destructive
        pending={pending}
        onConfirm={() => {
          if (nextId !== null && !pending) select(nextId);
        }}
        secondaryAction={{
          label: L._hierarchy.permissionSaveAndSwitch,
          onClick: () => {
            void saveAndSwitch();
          },
        }}
      />
    </div>
  );
}
