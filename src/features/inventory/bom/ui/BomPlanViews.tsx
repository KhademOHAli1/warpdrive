"use client";

import { useId } from "react";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";
import { CatalogCheckbox, CatalogSelect } from "../../catalog/ui/CatalogFields";
import type { BomEdge, BomPart, BomPlan, BomRelease } from "../contracts";
import { type BomChoice, partLabel, releaseLabel, useBomQuantity } from "./display";
import type { BomWords } from "./messages";

const headerCell = "px-3 py-2 text-start font-medium";
const lineCell = "px-3 py-2.5 text-start align-top tabular-nums";

function PartName({ part }: { part: BomPart }) {
  return (
    <>
      <bdi className="block break-words font-medium">{part.name}</bdi>
      <span className="block text-xs text-muted-foreground">
        <bdi>{part.code}</bdi> · <bdi>{part.revision}</bdi>
      </span>
    </>
  );
}

function Requirements({ plan, hasSite, t }: { plan: BomPlan; hasSite: boolean; t: BomWords }) {
  const heading = useId();
  const { quantity } = useBomQuantity();
  const hasUnattributedStock =
    hasSite &&
    plan.requirements.some(({ genericAssemblyAvailable }) => genericAssemblyAvailable > 0);
  return (
    <section className="min-w-0 rounded-lg border bg-card" aria-labelledby={heading}>
      <div className="space-y-1 px-3 py-3">
        <h2 id={heading} className="text-sm font-semibold">
          {t.requirements}
        </h2>
        {hasUnattributedStock && <p className="text-sm text-muted-foreground">{t.genericHelp}</p>}
      </div>
      {plan.requirements.length === 0 ? (
        <p className="px-3 pb-3 text-sm text-muted-foreground">{t.noRequirements}</p>
      ) : (
        <div className="overflow-x-auto border-t">
          <table className={cn("w-full text-sm", hasSite && "min-w-[32rem]")}>
            <thead className="border-b bg-muted/30 text-xs text-muted-foreground">
              <tr>
                <th scope="col" className={headerCell}>
                  {t.part}
                </th>
                <th scope="col" className={headerCell}>
                  {t.required}
                </th>
                {hasSite && (
                  <>
                    <th scope="col" className={headerCell}>
                      {t.available}
                    </th>
                    <th scope="col" className={headerCell}>
                      {t.shortage}
                    </th>
                  </>
                )}
                {hasUnattributedStock && (
                  <th scope="col" className={`${headerCell} max-w-40`}>
                    {t.genericStock}
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y">
              {plan.requirements.map((row) => {
                const { part, releaseId, required, available, shortage, genericAssemblyAvailable } =
                  row;
                return (
                  <tr
                    key={`${part.id}:${releaseId ?? ""}:${row.consumable}`}
                    data-bom-requirement-item={part.id}
                    data-bom-requirement-release={releaseId ?? undefined}
                    data-bom-consumable={row.consumable}
                  >
                    <th scope="row" className={`${lineCell} min-w-36 font-normal`}>
                      <PartName part={part} />
                      <div className="mt-1 flex flex-wrap gap-1">
                        {releaseId !== null && (
                          <a
                            className="text-xs text-primary underline-offset-4 hover:underline"
                            href={`#bom-release-${releaseId}`}
                          >
                            <bdi>
                              {t.pinnedRelease}{" "}
                              {plan.subassemblies.find(({ id }) => id === releaseId)?.revision}
                            </bdi>
                          </a>
                        )}
                        {row.consumable && <Badge variant="outline">{t.consumable}</Badge>}
                      </div>
                    </th>
                    <td className={lineCell} data-bom-required={required}>
                      <bdi>{quantity(required, part.unit)}</bdi>
                    </td>
                    {hasSite && (
                      <>
                        <td className={lineCell} data-bom-available={available}>
                          {row.consumable ? "—" : <bdi>{quantity(available, part.unit)}</bdi>}
                        </td>
                        <td className={lineCell} data-bom-shortage={shortage}>
                          {row.consumable ? (
                            "—"
                          ) : (
                            <bdi
                              className={shortage > 0 ? "font-medium text-destructive" : undefined}
                            >
                              {quantity(shortage, part.unit)}
                            </bdi>
                          )}
                        </td>
                      </>
                    )}
                    {hasUnattributedStock && (
                      <td
                        className={lineCell}
                        data-bom-generic-available={genericAssemblyAvailable}
                      >
                        {releaseId === null ? (
                          "—"
                        ) : (
                          <bdi>{quantity(genericAssemblyAvailable, part.unit)}</bdi>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function BomEdgeRow({
  edge,
  child,
  pending,
  change,
  t,
}: {
  edge: BomEdge;
  child?: BomRelease;
  pending: boolean;
  change: (choice: BomChoice) => void;
  t: BomWords;
}) {
  const includeId = useId();
  const { number, quantity } = useBomQuantity();
  const availableChoices = [edge.primary, ...edge.alternatives];
  const selected = availableChoices.find(({ id }) => id === edge.chosenItemId) ?? edge.primary;
  const target = { releaseId: edge.releaseId, itemId: edge.primary.id };
  const entered = quantity(edge.enteredQuantity, edge.enteredUnit);
  const normalized = quantity(selected.quantity, selected.unit);
  return (
    <tr
      data-bom-edge-item={edge.primary.id}
      data-bom-edge-release={edge.releaseId}
      data-bom-edge-chosen={edge.chosenItemId}
      data-bom-edge-included={edge.included}
    >
      <th scope="row" className={`${lineCell} min-w-36 font-normal`}>
        <PartName part={edge.primary} />
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {child !== undefined && (
            <a
              className="text-xs text-primary underline-offset-4 hover:underline"
              href={`#bom-release-${child.id}`}
            >
              <bdi>
                {t.pinnedRelease} {child.revision}
              </bdi>
            </a>
          )}
          {edge.optional && <Badge variant="outline">{t.optional}</Badge>}
          {edge.inherited && <Badge variant="outline">{t.inherited}</Badge>}
          {edge.consumable && <Badge variant="outline">{t.consumable}</Badge>}
        </div>
      </th>
      <td className={lineCell}>
        <bdi>{entered}</bdi>
        {entered !== normalized && (
          <span className="block text-xs text-muted-foreground">
            <bdi>{normalized}</bdi>
          </span>
        )}
        {edge.piecesPerParent !== null && (
          <dl className="mt-1 text-xs text-muted-foreground">
            <div className="flex flex-wrap gap-x-1">
              <dt>{t.cutsPerAssembly}</dt>
              <dd>
                <bdi>{number(edge.piecesPerParent)}</bdi>
              </dd>
            </div>
            {edge.requiredPieces !== null && (
              <div className="flex flex-wrap gap-x-1">
                <dt>{t.totalCuts}</dt>
                <dd data-bom-required-pieces={edge.requiredPieces}>
                  <bdi>{number(edge.requiredPieces)}</bdi>
                </dd>
              </div>
            )}
          </dl>
        )}
      </td>
      <td className={`${lineCell} sm:w-[35%]`}>
        <div className="space-y-2">
          {edge.optional && (
            <CatalogCheckbox
              id={includeId}
              label={t.includeOptional}
              checked={edge.included}
              disabled={pending}
              change={(include) => change({ ...target, include })}
            />
          )}
          {edge.alternatives.length > 0 && (
            <CatalogSelect
              ariaLabel={`${t.approvedComponent} · ${edge.primary.code}`}
              value={edge.chosenItemId}
              options={availableChoices.map((part) => ({
                value: part.id,
                label: partLabel(part),
              }))}
              onChange={(id) =>
                change({ ...target, substituteItemId: id === edge.primary.id ? undefined : id })
              }
              disabled={pending}
            />
          )}
          {!edge.optional && edge.alternatives.length === 0 && "—"}
        </div>
      </td>
    </tr>
  );
}

function ReleasedStructure({
  plan,
  pending,
  change,
  t,
}: {
  plan: BomPlan;
  pending: boolean;
  change: (choice: BomChoice) => void;
  t: BomWords;
}) {
  const heading = useId();
  const byRelease = new Map<string, BomEdge[]>();
  for (const edge of plan.edges) {
    const existing = byRelease.get(edge.releaseId);
    if (existing === undefined) byRelease.set(edge.releaseId, [edge]);
    else existing.push(edge);
  }
  const releases = [plan.release, ...plan.subassemblies];
  const pinned = new Map(releases.map((release) => [release.id, release]));
  return (
    <section className="min-w-0 space-y-2" aria-labelledby={heading}>
      <h2 id={heading} className="text-sm font-semibold">
        {t.bom}
      </h2>
      {releases.map((release) => (
        <article
          key={release.id}
          id={`bom-release-${release.id}`}
          data-bom-structure-release={release.id}
          className="scroll-mt-4 rounded-lg border bg-card"
        >
          <header className="space-y-1 px-3 py-3">
            <h3 className="break-words text-sm font-medium">
              <bdi>{releaseLabel(release, t)}</bdi>
            </h3>
            <p className="text-xs text-muted-foreground">
              {release.checksum === null ? (
                t.checksumUnavailable
              ) : (
                <>
                  {t.checksum}{" "}
                  <code className="break-all" dir="ltr" data-bom-checksum={release.checksum}>
                    {t.checksumAlgorithm} {release.checksum}
                  </code>
                </>
              )}
            </p>
          </header>
          <div className="overflow-x-auto border-t">
            <table className="w-full min-w-[31rem] text-sm">
              <thead className="border-b bg-muted/30 text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className={headerCell}>
                    {t.part}
                  </th>
                  <th scope="col" className={headerCell}>
                    {t.perAssembly}
                  </th>
                  <th scope="col" className={headerCell}>
                    {t.choices}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {byRelease.get(release.id)?.map((edge) => (
                  <BomEdgeRow
                    key={edge.primary.id}
                    edge={edge}
                    child={
                      edge.childReleaseId === null ? undefined : pinned.get(edge.childReleaseId)
                    }
                    pending={pending}
                    change={change}
                    t={t}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </article>
      ))}
    </section>
  );
}

export function BomPlanViews({
  plan,
  hasSite,
  pending,
  change,
  t,
}: {
  plan: BomPlan;
  hasSite: boolean;
  pending: boolean;
  change: (choice: BomChoice) => void;
  t: BomWords;
}) {
  return (
    <div
      data-bom-plan-release-id={plan.release.id}
      data-bom-build-quantity={plan.quantity}
      aria-busy={pending}
      className="min-w-0 space-y-4"
    >
      <Requirements plan={plan} hasSite={hasSite} t={t} />
      <ReleasedStructure plan={plan} pending={pending} change={change} t={t} />
    </div>
  );
}
