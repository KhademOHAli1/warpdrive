"use client";

import { type FormEvent, useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import {
  type Location,
  type LocationChange,
  type LocationDirectory,
  locationPath,
  type Site,
} from "./directory";
import type { LocationWriteError } from "./LocationsDirectory";
import { locationsMessages } from "./locationsMessages";

export type LocationEditorTarget =
  | { kind: "site"; record: Site | null }
  | { kind: "location"; record: Location | null; siteId: string };

export function LocationEditor({
  directory,
  target,
  submit,
  pending,
  close,
  focusTrigger,
}: {
  directory: LocationDirectory;
  target: LocationEditorTarget;
  submit: (change: LocationChange) => Promise<LocationWriteError | null>;
  pending: boolean;
  close: () => void;
  focusTrigger: () => void;
}) {
  const locale = useLocale();
  const t = locationsMessages[locale];
  const nameId = useId();
  const codeId = useId();
  const [name, setName] = useState(target.record?.name ?? "");
  const [code, setCode] = useState(target.record?.code ?? "");
  const [parent, setParent] = useState(
    target.kind === "location" ? (target.record?.parentId ?? "") : "",
  );
  const [error, setError] = useState<LocationWriteError | null>(null);
  const editingLocation = target.kind === "location";
  const title = editingLocation
    ? target.record === null
      ? t.addLocation
      : t.editLocation
    : target.record === null
      ? t.addSite
      : t.editSite;
  const parents = editingLocation
    ? directory.locations
        .filter((candidate) => candidate.siteId === target.siteId && !candidate.archived)
        .map((location) => ({ location, path: locationPath(directory.locations, location) }))
        .filter(({ path }) => !path.some(({ id }) => id === target.record?.id))
        .map(({ location, path }) => ({
          value: location.id,
          label: `${path.map((entry) => entry.name).join(" / ")} · ${location.code}`,
        }))
        .sort((a, b) => a.label.localeCompare(b.label, locale))
    : [];

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    const values = { id: target.record?.id ?? null, name, code };
    const change: LocationChange =
      target.kind === "location"
        ? { type: "saveLocation", siteId: target.siteId, parentId: parent || null, ...values }
        : { type: "saveSite", ...values };
    const issue = await submit(change);
    if (issue !== null) setError(issue);
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!pending && !open) close();
      }}
    >
      <DialogContent
        className={`${BLOCK_CLASS} ph-no-capture`}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          focusTrigger();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {editingLocation ? t.editorDescription : t.siteEditorDescription}
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={(event) => void onSubmit(event)}>
          <div className="grid gap-1.5">
            <label htmlFor={nameId} className="text-sm font-medium">
              {t.name}
            </label>
            <Input
              id={nameId}
              required
              disabled={pending}
              maxLength={100}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <label htmlFor={codeId} className="text-sm font-medium">
              {t.code}
            </label>
            <Input
              id={codeId}
              dir="ltr"
              required
              disabled={pending}
              maxLength={24}
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </div>
          {editingLocation && (
            <div className="grid gap-1.5">
              <span className="text-sm font-medium">{t.parent}</span>
              <Select
                ariaLabel={t.parent}
                value={parent}
                onChange={setParent}
                disabled={pending}
                options={[{ value: "", label: t.noParent }, ...parents]}
                triggerClassName="h-9 min-w-0 gap-2 [&>span]:min-w-0 [&>span]:truncate"
                contentClassName={`${BLOCK_CLASS} ph-no-capture max-w-[min(28rem,90vw)]`}
              />
            </div>
          )}
          {error !== null && (
            <p role="alert" className="text-sm text-destructive">
              {t[error]}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={close}>
              {t.cancel}
            </Button>
            <Button type="submit" disabled={pending}>
              {t.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
