"use client";

import { useId, useState } from "react";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { CatalogCheckbox } from "@/features/inventory/catalog/ui/CatalogFields";
import { SalesInput } from "@/features/inventory/sales/ui/SalesFields";
import { instantParts, wallTimeToInstant } from "@/lib/zonedDateTime";
import { EditorSelect } from "../../ui/AssetEditorFields";
import type {
  EquipmentAuditDetail,
  EquipmentAuditIntent,
  EquipmentAuditScope,
  EquipmentAuditSite,
} from "../contracts";
import { AuditCommandDialog, type AuditDialogState, AuditOptionGroup } from "./AuditDialog";
import { emptyAuditScope } from "./auditView";
import type { AuditWords } from "./messages";

function dueField(due: string | null, timeZone: string) {
  if (due === null) return "";
  const { date, time } = instantParts(due, timeZone);
  return `${date}T${time}`;
}

function dueInstant(value: string, old: string | null, zone: string): string | null | undefined {
  if (value === "") return null;
  if (value === dueField(old, zone)) return old;
  const [day, time] = value.split("T");
  if (day === undefined || time === undefined) return undefined;
  try {
    const resolved = wallTimeToInstant(day, time, zone);
    return resolved.ambiguous ? undefined : resolved.iso;
  } catch {
    return undefined;
  }
}

function locationOptions(site: EquipmentAuditSite) {
  const byId = new Map(site.locations.map((location) => [location.id, location]));
  return site.locations.map(({ id, name, parentId }) => {
    const names = [name];
    const visited = new Set([id]);
    let current = parentId;
    while (current !== null && !visited.has(current)) {
      const parent = byId.get(current);
      if (parent === undefined) break;
      visited.add(current);
      names.unshift(parent.name);
      current = parent.parentId;
    }
    return { id, name: names.join(" / ") };
  });
}

function ScopeEditor({
  site,
  scope,
  change,
  pending,
  words: t,
}: {
  site: EquipmentAuditSite;
  scope: EquipmentAuditScope;
  change: (scope: EquipmentAuditScope) => void;
  pending: boolean;
  words: AuditWords;
}) {
  const id = useId();
  const targets = site.targets.map(({ id, kind, name, code }) => ({
    id,
    kind,
    name: `${name} · ${code}`,
  }));
  const groups = [
    { key: "locationIds", title: t.locations, options: locationOptions(site) },
    {
      key: "assetIds",
      title: t.equipment,
      options: targets.filter(({ kind }) => kind === "asset"),
    },
    { key: "kitIds", title: t.kits, options: targets.filter(({ kind }) => kind === "kit") },
    { key: "categoryIds", title: t.categories, options: site.categories },
  ] as const;
  return (
    <fieldset className="space-y-3" disabled={pending}>
      <legend className="font-medium">{t.scope}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {groups.map(({ key, title, options }) => (
          <AuditOptionGroup
            key={key}
            {...{ title, options, pending }}
            selected={scope[key]}
            change={(ids) => change({ ...scope, [key]: ids })}
            words={t}
          />
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <EditorSelect
          label={t.tag}
          value={scope.tag ?? ""}
          disabled={pending}
          options={[
            { value: "", label: t.noTag },
            ...site.tags.map((tag) => ({ value: tag, label: tag })),
          ]}
          onChange={(tag) => change({ ...scope, tag: tag === "" ? null : tag })}
        />
        <div className="flex flex-col gap-1">
          <CatalogCheckbox
            id={`${id}-children`}
            label={t.includeChildren}
            checked={scope.includeChildren}
            change={(includeChildren) => change({ ...scope, includeChildren })}
            disabled={pending || scope.locationIds.length === 0}
          />
          <CatalogCheckbox
            id={`${id}-custody`}
            label={t.includeCustody}
            checked={scope.includeCustody}
            change={(includeCustody) => change({ ...scope, includeCustody })}
            disabled={pending}
          />
        </div>
      </div>
    </fieldset>
  );
}

type DraftProps = {
  site: EquipmentAuditSite;
  detail?: EquipmentAuditDetail;
  state: AuditDialogState;
  words: AuditWords;
};

export function AuditDraftDialog({
  type,
  site,
  detail,
  state,
  words: t,
}: DraftProps & { type: "create" | "edit" | "duplicate" }) {
  const { timeZone: zone } = useLocalePreferences();
  const originalDue = type === "duplicate" ? null : (detail?.dueAt ?? null);
  const [title, setTitle] = useState(detail?.title ?? "");
  const [scope, setScope] = useState(detail?.scope ?? emptyAuditScope);
  const [due, setDue] = useState(() => dueField(originalDue, zone));
  const [assigneeIds, setAssignees] = useState(() => detail?.assignees.map(({ id }) => id) ?? []);
  const dueAt = dueInstant(due, originalDue, zone);
  const details = { title, dueAt: dueAt ?? null, scope, assigneeIds };
  const context = detail === undefined ? null : { auditId: detail.id, version: detail.version };
  let intent: EquipmentAuditIntent | null = null;
  if (dueAt !== undefined) {
    if (type === "create") intent = { type, siteId: site.id, ...details };
    if (type === "edit" && context !== null) intent = { type, ...context, ...details };
    if (type === "duplicate" && context !== null) intent = { type, ...context, title, dueAt };
  }
  return (
    <AuditCommandDialog
      type={type}
      title={t[type]}
      description={type === "duplicate" ? t.duplicateIntro : t.draftIntro}
      state={state}
      intent={intent}
      words={t}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <SalesInput
          label={t.name}
          value={title}
          required
          disabled={state.pending}
          maxLength={120}
          onChange={(event) => setTitle(event.currentTarget.value)}
        />
        <SalesInput
          label={`${t.due} (${zone})`}
          data-audit-due-input
          type="datetime-local"
          value={due}
          disabled={state.pending}
          onChange={(event) => setDue(event.currentTarget.value)}
        />
      </div>
      {dueAt === undefined && (
        <p role="alert" className="text-sm text-destructive">
          {t.invalidDue}
        </p>
      )}
      {type !== "duplicate" && (
        <>
          <ScopeEditor {...{ site, scope }} change={setScope} pending={state.pending} words={t} />
          <AuditOptionGroup
            title={t.assignees}
            options={site.auditors}
            selected={assigneeIds}
            change={setAssignees}
            pending={state.pending}
            words={t}
          />
        </>
      )}
    </AuditCommandDialog>
  );
}

export function AuditAssignDialog({
  site,
  detail,
  state,
  words: t,
}: DraftProps & { detail: EquipmentAuditDetail }) {
  const [assigneeIds, setAssignees] = useState(() => detail.assignees.map(({ id }) => id));
  return (
    <AuditCommandDialog
      type="assign"
      title={t.assign}
      description={t.draftIntro}
      state={state}
      words={t}
      intent={{ type: "assign", auditId: detail.id, version: detail.version, assigneeIds }}
    >
      <AuditOptionGroup
        title={t.assignees}
        options={site.auditors}
        selected={assigneeIds}
        change={setAssignees}
        pending={state.pending}
        words={t}
      />
    </AuditCommandDialog>
  );
}
