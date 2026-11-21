"use client";

import { GitBranch, Layers, Pencil } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useLocale, useNumberingSystem } from "@/features/i18n/LocaleProvider";
import { CatalogPartFiles } from "../CatalogPartFiles";
import type { CatalogPart, CatalogWorkspace } from "../contracts";
import { CatalogField, CatalogSelect } from "./CatalogFields";
import type { PartTarget } from "./CatalogPartEditor";
import {
  catalogFlagKeys,
  catalogPartLabel,
  categoryTrail,
  currentState,
  partType,
  unitLabel,
} from "./catalogDisplay";
import { type CatalogWords, catalogMessages } from "./catalogMessages";
import type { CatalogSave } from "./catalogTypes";

export function CatalogPartDetails({
  part,
  workspace,
  pending,
  fixture,
  openEditor,
  choose,
  saveState,
}: {
  part: CatalogPart;
  workspace: CatalogWorkspace;
  pending: boolean;
  fixture: boolean;
  openEditor: (trigger: HTMLButtonElement, target: PartTarget) => void;
  choose: (partId: string) => void;
  saveState: CatalogSave;
}) {
  const locale = useLocale();
  const t = catalogMessages[locale];
  const state = currentState(workspace, part);
  const [stateId, setStateId] = useState(part.profile.stateId ?? "");
  const { profile } = part;
  const canEdit = workspace.canManage && state?.locked !== true;
  const path = categoryTrail(workspace.categories, profile.categoryId)
    .map(({ name }) => name)
    .join(" / ");
  const sections = [
    {
      label: t.revisions,
      entries: workspace.parts.filter(
        (item) => item.familyId === part.familyId && item.id !== part.id,
      ),
    },
    {
      label: t.variants,
      entries: workspace.parts.filter((item) => item.profile.templateItemId === part.id),
    },
    {
      label: t.relatedParts,
      entries: workspace.parts.filter((item) => profile.relatedItemIds.includes(item.id)),
    },
    {
      label: t.whereUsed,
      entries: workspace.parts.filter((item) => part.whereUsedByIds.includes(item.id)),
    },
  ];

  return (
    <aside className="min-w-0 space-y-3" aria-label={t.descriptionSection}>
      <section className="space-y-3 rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="break-words text-xs text-muted-foreground">
              <bdi dir="ltr">{part.code}</bdi> · <bdi dir="auto">{part.revision}</bdi>
            </p>
            <h2 className="break-words text-lg font-semibold">
              <bdi dir="auto">{part.name}</bdi>
            </h2>
          </div>
          <div className="flex flex-wrap gap-1">
            <Badge variant="outline">{t[partType(part)]}</Badge>
            <Badge variant="outline">{state?.name ?? t.active}</Badge>
            {state?.locked === true && <Badge variant="secondary">{t.locked}</Badge>}
          </div>
        </div>
        {profile.description !== "" && (
          <p className="whitespace-pre-wrap break-words text-sm">{profile.description}</p>
        )}
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <CatalogDetail label={t.sku} value={part.sku} />
          <CatalogDetail label={t.category} value={path || t.noCategory} />
          <CatalogDetail label={t.unit} value={unitLabel(profile.unit, t)} />
          <CatalogDetail
            label={t.visibility}
            value={profile.visibility === "admin" ? t.managers : t.workspace}
          />
        </dl>
        {profile.tags.length > 0 && (
          <ul className="flex flex-wrap gap-1" aria-label={t.tags}>
            {profile.tags.map((tag) => (
              <li key={tag}>
                <Badge variant="secondary">
                  <bdi>{tag}</bdi>
                </Badge>
              </li>
            ))}
          </ul>
        )}
        <ul className="flex flex-wrap gap-1" aria-label={t.flags}>
          {catalogFlagKeys
            .filter((flag) => profile.flags[flag])
            .map((flag) => (
              <li key={flag}>
                <Badge variant="outline">{t[flag]}</Badge>
              </li>
            ))}
        </ul>
        {workspace.canManage && (
          <div className="grid gap-3 border-t pt-3">
            <div className="flex flex-wrap gap-2">
              {canEdit && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={(event) => openEditor(event.currentTarget, { mode: "edit", part })}
                >
                  <Pencil aria-hidden="true" />
                  {t.editPart}
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={(event) => openEditor(event.currentTarget, { mode: "revision", part })}
              >
                <GitBranch aria-hidden="true" />
                {t.addRevision}
              </Button>
              {profile.isTemplate && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={(event) => openEditor(event.currentTarget, { mode: "variant", part })}
                >
                  <Layers aria-hidden="true" />
                  {t.addVariant}
                </Button>
              )}
            </div>
            {state?.locked === true && (
              <p className="text-xs text-muted-foreground">{t.lockedEdit}</p>
            )}
            {workspace.states.length > 0 && (
              <form
                className="flex flex-wrap items-end gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!pending)
                    void saveState({
                      type: "setPartState",
                      id: part.id,
                      stateId: stateId || null,
                      version: profile.version,
                    });
                }}
              >
                <div className="min-w-32 flex-1">
                  <CatalogField label={t.state}>
                    <CatalogSelect
                      ariaLabel={t.state}
                      value={stateId}
                      disabled={pending}
                      options={[
                        { value: "", label: t.defaultState },
                        ...workspace.states.map(({ id, name }) => ({ value: id, label: name })),
                      ]}
                      onChange={setStateId}
                    />
                  </CatalogField>
                </div>
                <Button
                  type="submit"
                  size="sm"
                  variant="outline"
                  className="h-9"
                  disabled={pending || stateId === (profile.stateId ?? "")}
                >
                  {t.applyState}
                </Button>
              </form>
            )}
          </div>
        )}
        {!fixture && (
          <Link
            href={`/inventory?itemId=${encodeURIComponent(part.id)}`}
            className="inline-block text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            {t.openInventory}
          </Link>
        )}
      </section>
      <CatalogParameterDetails part={part} t={t} />
      {profile.notes !== "" && (
        <section className="space-y-2 rounded-lg border bg-card p-4">
          <h3 className="text-sm font-semibold">{t.notes}</h3>
          <p className="whitespace-pre-wrap break-words text-sm">{profile.notes}</p>
        </section>
      )}
      {sections.map(
        ({ label, entries }) =>
          entries.length > 0 && (
            <section key={label} className="space-y-2 rounded-lg border bg-card p-4">
              <h3 className="text-sm font-semibold">{label}</h3>
              <ul className="space-y-1">
                {entries.map((item) => (
                  <li key={item.id}>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-auto min-h-8 max-w-full whitespace-normal text-start"
                      onClick={() => choose(item.id)}
                    >
                      <bdi className="break-words">{catalogPartLabel(item)}</bdi>
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          ),
      )}
      {!fixture && <CatalogPartFiles itemId={part.id} canUpload={canEdit} />}
    </aside>
  );
}

function CatalogDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words">
        <bdi dir="auto">{value}</bdi>
      </dd>
    </div>
  );
}

function CatalogParameterDetails({ part, t }: { part: CatalogPart; t: CatalogWords }) {
  const locale = useLocale();
  const numberingSystem = useNumberingSystem();
  const numbers = new Intl.NumberFormat(locale, { numberingSystem, maximumFractionDigits: 10 });
  if (part.parameters.length === 0) return null;
  return (
    <section className="space-y-2 rounded-lg border bg-card p-4">
      <h3 className="text-sm font-semibold">{t.parameters}</h3>
      <dl className="space-y-1">
        {part.parameters.map((definition) => {
          const parameter = part.profile.values.find(({ key }) => key === definition.key);
          return (
            <CatalogDetail
              key={definition.key}
              label={definition.label}
              value={parameter === undefined ? t.unset : formatParameter(parameter, t, numbers)}
            />
          );
        })}
      </dl>
    </section>
  );
}

function formatParameter(
  { value, unit }: CatalogPart["profile"]["values"][number],
  t: CatalogWords,
  numbers: Intl.NumberFormat,
) {
  if (typeof value === "boolean") return value ? t.enabled : t.disabled;
  if (typeof value === "string") return value;
  const amount = numbers.format(value);
  return unit === null ? amount : `${amount} ${unitLabel(unit, t)}`;
}
