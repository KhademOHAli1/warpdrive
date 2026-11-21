"use client";

import { keepPreviousData } from "@tanstack/react-query";
import { useId, useState } from "react";
import { PageHeading } from "@/components/shell/PageHeading";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { trpc } from "@/lib/trpc-client";
import { CatalogField, CatalogSelect } from "../../catalog/ui/CatalogFields";
import type { BomPlanningQuery, BomPlanningResult, BomPlanningWorkspace } from "../contracts";
import { BomPlanViews } from "./BomPlanViews";
import { BomComparisonView, BomWhereUsed } from "./BomReferenceViews";
import { type BomChoice, releaseLabel } from "./display";
import { type BomWords, bomMessages } from "./messages";

function amendedChoices(
  choices: BomPlanningQuery["choices"],
  choice: BomChoice,
): BomPlanningQuery["choices"] {
  const next = [...(choices ?? [])];
  const index = next.findIndex(
    ({ releaseId, itemId }) => releaseId === choice.releaseId && itemId === choice.itemId,
  );
  const amended = { ...next[index], ...choice };
  if (amended.substituteItemId === undefined && amended.include !== true) {
    if (index >= 0) next.splice(index, 1);
    return next;
  }
  if (index < 0) next.push(amended);
  else next[index] = amended;
  return next;
}

function BomPlannerFilters({
  workspace,
  scope,
  pending,
  update,
  recalculate,
  t,
}: {
  workspace: BomPlanningWorkspace;
  scope: BomPlanningQuery;
  pending: boolean;
  update: (scope: BomPlanningQuery) => void;
  recalculate: () => void;
  t: BomWords;
}) {
  const quantityId = useId();
  const [quantity, setQuantity] = useState(String(scope.quantity ?? 1));
  const known = workspace.releases;
  const releaseId = scope.releaseId ?? workspace.plan?.release.id;
  const selected = known.find(({ id }) => id === releaseId);
  const compare = known.filter(
    ({ id, part }) => part.code === selected?.part.code && id !== releaseId,
  );
  const ready =
    Number.isInteger(Number(quantity)) && Number(quantity) >= 1 && Number(quantity) <= 1_000_000;
  return (
    <form
      data-bom-filters
      className="grid min-w-0 gap-3 rounded-lg border bg-card p-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(8.75rem,.65fr)_auto] xl:items-end"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready && releaseId !== undefined) {
          const count = Number(quantity);
          if (count === (scope.quantity ?? 1)) recalculate();
          else update({ ...scope, releaseId, quantity: count });
        }
      }}
    >
      <CatalogField label={t.release}>
        <CatalogSelect
          ariaLabel={t.release}
          value={releaseId ?? ""}
          placeholder={t.chooseRelease}
          options={known.map((release) => ({
            value: release.id,
            label: releaseLabel(release, t),
          }))}
          onChange={(id) =>
            update({
              ...scope,
              releaseId: id,
              ...(ready ? { quantity: Number(quantity) } : {}),
              choices: undefined,
              compareReleaseId: undefined,
            })
          }
          disabled={known.length === 0}
        />
      </CatalogField>
      <CatalogField label={t.site}>
        <CatalogSelect
          ariaLabel={t.site}
          value={scope.siteId ?? ""}
          options={[
            { value: "", label: t.grossDemand },
            ...workspace.sites.map(({ id, name, code }) => ({
              value: id,
              label: `${name} · ${code}`,
            })),
          ]}
          onChange={(siteId) => update({ ...scope, releaseId, siteId: siteId || undefined })}
          disabled={workspace.sites.length === 0}
        />
      </CatalogField>
      <CatalogField label={t.compareWith}>
        <CatalogSelect
          ariaLabel={t.compareWith}
          value={scope.compareReleaseId ?? ""}
          options={[
            { value: "", label: t.noComparison },
            ...compare.map(({ id, part, revision }) => ({
              value: id,
              label:
                part.id === selected?.part.id
                  ? revision
                  : `${part.revision} · ${t.release} ${revision}`,
            })),
          ]}
          onChange={(id) => update({ ...scope, releaseId, compareReleaseId: id || undefined })}
          disabled={compare.length === 0}
        />
      </CatalogField>
      <CatalogField label={t.quantity} id={quantityId}>
        <Input
          id={quantityId}
          className="h-9 tabular-nums"
          type="number"
          min={1}
          max={1_000_000}
          step={1}
          required
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
        />
      </CatalogField>
      <div className="flex sm:justify-end xl:self-end">
        <Button
          type="submit"
          size="sm"
          className="h-9"
          disabled={pending || !ready || selected === undefined}
        >
          {t.calculate}
        </Button>
      </div>
    </form>
  );
}

export function BomPlanner({
  initialScope,
  initial,
}: {
  initialScope: BomPlanningQuery;
  initial: BomPlanningResult;
}) {
  const locale = useLocale();
  const t = bomMessages[locale];
  const [scope, setScope] = useState(initialScope);
  const query = trpc.inventory.bom.workspace.useQuery(scope, {
    initialData: scope === initialScope ? initial : undefined,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: "always",
    retry: false,
    gcTime: 0,
  });
  const result = query.data;
  const workspace = query.isError || result?.ok !== true ? null : result.value;
  const error = query.isError ? "unavailable" : result?.ok === false ? result.error : null;
  const pending = query.isFetching;
  const currentPlan = workspace?.plan;
  const stalePlan =
    query.isPlaceholderData &&
    ((scope.releaseId !== undefined && currentPlan?.release.id !== scope.releaseId) ||
      (scope.siteId ?? null) !== workspace?.siteId);

  return (
    <div className={`${BLOCK_CLASS} ph-no-capture min-w-0 pb-4`} data-bom-planner>
      <PageHeading
        title={t.title}
        description={t.description}
        crumbs={[{ label: t.inventory, href: "/inventory" }, { label: t.title }]}
      />
      {error !== null && (
        <div className="space-y-2 rounded-lg border bg-card p-4">
          <p role="alert" className="text-sm text-destructive">
            {t[error]}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => void query.refetch()}
            >
              {t.retry}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => setScope({})}
            >
              {t.reset}
            </Button>
          </div>
        </div>
      )}
      {workspace !== null && (
        <div className="space-y-3">
          <BomPlannerFilters
            workspace={workspace}
            scope={scope}
            pending={pending}
            update={setScope}
            recalculate={() => void query.refetch()}
            t={t}
          />
          {pending && (
            <p role="status" className="text-sm text-muted-foreground">
              {t.loading}
            </p>
          )}
          {workspace.releases.length === 0 && !pending && (
            <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
              {t.noReleases}
            </p>
          )}
          {currentPlan != null && !stalePlan && (
            <BomPlanViews
              plan={currentPlan}
              hasSite={workspace.siteId !== null}
              pending={pending}
              change={(choice) =>
                setScope((scopeNow) => ({
                  ...scopeNow,
                  releaseId: currentPlan.release.id,
                  choices: amendedChoices(scopeNow.choices, choice),
                }))
              }
              t={t}
            />
          )}
          {workspace.comparison !== null && !query.isPlaceholderData && currentPlan != null && (
            <BomComparisonView plan={currentPlan} comparison={workspace.comparison} t={t} />
          )}
          {workspace.whereUsedPart !== null && (
            <BomWhereUsed
              part={workspace.whereUsedPart}
              entries={workspace.whereUsed}
              siteId={scope.siteId}
              t={t}
            />
          )}
        </div>
      )}
      {workspace === null && error === null && (
        <p role="status" className="text-sm text-muted-foreground">
          {t.loading}
        </p>
      )}
    </div>
  );
}
