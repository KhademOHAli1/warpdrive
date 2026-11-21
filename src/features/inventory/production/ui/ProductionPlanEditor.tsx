"use client";

import { useId, useState } from "react";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { trpc } from "@/lib/trpc-client";
import type { BomPlan, BomPlanningQuery } from "../../bom/contracts";
import { partLabel, releaseLabel } from "../../bom/ui/display";
import { bomMessages } from "../../bom/ui/messages";
import {
  CatalogCheckbox,
  CatalogEditorDialog,
  CatalogField,
  CatalogSelect,
} from "../../catalog/ui/CatalogFields";
import type { ProductionWorkspace } from "../contracts";
import type { ProductionMessages } from "./messages";
import {
  type BuildSchedule,
  ProductionQuantityField,
  ProductionScheduleFields,
  parsedQuantity,
} from "./ProductionFields";
import { type ProductionDialog, siteCanPlan } from "./types";

type Choice = NonNullable<BomPlanningQuery["choices"]>[number];

function EditBomChoices({
  plan,
  choices,
  change,
  disabled,
  t,
}: {
  plan: BomPlan;
  choices: Choice[];
  change: (choices: Choice[]) => void;
  disabled: boolean;
  t: ProductionMessages;
}) {
  const idPrefix = useId();
  const labels = new Map(
    [plan.release, ...plan.subassemblies].map((release) => [release.id, partLabel(release.part)]),
  );
  const edges = plan.edges.filter((edge) => edge.optional || edge.alternatives.length > 0);
  if (edges.length === 0) return null;

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{t.bomChoices}</legend>
      {edges.map((edge, index) => {
        const selected = choices.find(
          (choice) => choice.releaseId === edge.releaseId && choice.itemId === edge.primary.id,
        );
        const include = selected?.include ?? !edge.optional;
        const substitute = selected?.substituteItemId ?? edge.primary.id;
        const key = `${edge.releaseId}:${edge.primary.id}`;
        const update = (active: boolean, substituteItemId: string) => {
          const other = choices.filter(
            (choice) => choice.releaseId !== edge.releaseId || choice.itemId !== edge.primary.id,
          );
          if (!active || (!edge.optional && substituteItemId === edge.primary.id)) {
            change(other);
            return;
          }
          change([
            ...other,
            {
              releaseId: edge.releaseId,
              itemId: edge.primary.id,
              ...(edge.optional ? { include: true } : {}),
              ...(substituteItemId !== edge.primary.id ? { substituteItemId } : {}),
            },
          ]);
        };
        return (
          <div
            key={key}
            className="min-w-0 space-y-1.5 rounded-lg border p-3"
            data-production-bom-choice={key}
          >
            <p className="text-sm font-medium">
              <bdi>{partLabel(edge.primary)}</bdi>
            </p>
            <p className="text-xs text-muted-foreground">
              <bdi>{labels.get(edge.releaseId)}</bdi>
            </p>
            {edge.optional && (
              <CatalogCheckbox
                id={`${idPrefix}-${index}`}
                label={t.include}
                checked={include}
                disabled={disabled}
                change={(active) => update(active, substitute)}
              />
            )}
            {include && edge.alternatives.length > 0 && (
              <CatalogField label={t.approvedAlternative}>
                <CatalogSelect
                  ariaLabel={`${t.approvedAlternative} · ${edge.primary.code}`}
                  value={substitute}
                  options={[edge.primary, ...edge.alternatives].map((part) => ({
                    value: part.id,
                    label: partLabel(part),
                  }))}
                  onChange={(partId) => update(true, partId)}
                  disabled={disabled}
                />
              </CatalogField>
            )}
          </div>
        );
      })}
    </fieldset>
  );
}

export function ProductionPlanEditor({
  workspace,
  initialSiteId,
  initialReleaseId,
  dialog,
  t,
}: {
  workspace: ProductionWorkspace;
  initialSiteId?: string;
  initialReleaseId?: string;
  dialog: ProductionDialog;
  t: ProductionMessages;
}) {
  const templateId = useId();
  const bom = bomMessages[useLocale()];
  const sites = workspace.sites.filter(siteCanPlan);
  const [siteId, setSiteId] = useState(
    sites.find(({ id }) => id === initialSiteId)?.id ?? sites[0]?.id ?? "",
  );
  const site = sites.find(({ id }) => id === siteId);
  const [locationId, setLocationId] = useState("");
  const location = site?.locations.find(({ id }) => id === locationId) ?? site?.locations[0];
  const [releaseId, setReleaseId] = useState(
    workspace.releases.find(({ id }) => id === initialReleaseId)?.id ?? "",
  );
  const release = workspace.releases.find(({ id }) => id === releaseId);
  const [quantity, setQuantity] = useState("1");
  const [schedule, setSchedule] = useState<BuildSchedule>({ priority: "normal", dueDate: "" });
  const [useTemplate, setUseTemplate] = useState(false);
  const [choices, setChoices] = useState<Choice[]>([]);
  const total = parsedQuantity(quantity, 1_000_000);
  const graph = trpc.inventory.bom.workspace.useQuery(
    { releaseId: release?.id },
    { enabled: release !== undefined, refetchOnWindowFocus: "always", retry: false, gcTime: 0 },
  );
  const plan = graph.data?.ok === true && !graph.isError ? graph.data.value.plan : null;
  const canUseGraph = plan?.release.id === releaseId;
  return (
    <CatalogEditorDialog
      {...dialog}
      title={t.planBuild}
      description={t.planBuildDescription}
      submitDisabled={
        dialog.blocked ||
        site === undefined ||
        location === undefined ||
        release === undefined ||
        total === null ||
        !canUseGraph ||
        choices.length > 120
      }
      submit={() => {
        if (
          site === undefined ||
          location === undefined ||
          release === undefined ||
          total === null ||
          !canUseGraph
        )
          return;
        dialog.save({
          type: "createBuild",
          releaseId: release.id,
          siteId: site.id,
          locationId: location.id,
          quantity: total,
          priority: schedule.priority,
          dueDate: schedule.dueDate || null,
          useTemplate: release.templateAvailable && useTemplate,
          choices,
        });
      }}
    >
      <CatalogField label={t.release}>
        <CatalogSelect
          ariaLabel={t.release}
          options={workspace.releases.map((entry) => ({
            value: entry.id,
            label: releaseLabel(entry, bom),
          }))}
          value={releaseId}
          placeholder={t.chooseRelease}
          onChange={(id) => {
            setReleaseId(id);
            setUseTemplate(false);
            setChoices([]);
          }}
          disabled={dialog.pending}
        />
      </CatalogField>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <CatalogField label={t.site}>
          <CatalogSelect
            ariaLabel={t.site}
            options={sites.map(({ id, code, name }) => ({ value: id, label: `${code} · ${name}` }))}
            value={siteId}
            onChange={(id) => {
              setSiteId(id);
              setLocationId("");
            }}
            disabled={dialog.pending}
          />
        </CatalogField>
        <CatalogField label={t.outputBin}>
          <CatalogSelect
            ariaLabel={t.outputBin}
            options={(site?.locations ?? []).map(({ id, code, name }) => ({
              value: id,
              label: `${code} · ${name}`,
            }))}
            value={location?.id ?? ""}
            onChange={setLocationId}
            disabled={dialog.pending || site === undefined}
          />
        </CatalogField>
      </div>
      <ProductionQuantityField
        label={t.quantity}
        value={quantity}
        change={setQuantity}
        disabled={dialog.pending}
      />
      <ProductionScheduleFields
        value={schedule}
        change={setSchedule}
        pending={dialog.pending}
        t={t}
      />
      {release?.templateAvailable === true && (
        <CatalogCheckbox
          id={templateId}
          label={t.useTemplate}
          checked={useTemplate}
          disabled={dialog.pending}
          change={setUseTemplate}
        />
      )}
      {plan !== null && canUseGraph && (
        <EditBomChoices
          key={plan.release.id}
          plan={plan}
          choices={choices}
          change={setChoices}
          disabled={dialog.pending}
          t={t}
        />
      )}
      {release !== undefined &&
        !canUseGraph &&
        (graph.isFetching ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t.loadingBom}
          </p>
        ) : (
          <p role="alert" className="text-sm text-destructive">
            {t.unavailable}
          </p>
        ))}
      {choices.length > 120 && (
        <p role="alert" className="text-sm text-destructive">
          {t.limit}
        </p>
      )}
    </CatalogEditorDialog>
  );
}
