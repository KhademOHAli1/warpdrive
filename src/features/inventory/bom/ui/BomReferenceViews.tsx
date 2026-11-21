"use client";

import Link from "next/link";
import { useId } from "react";
import { Badge } from "@/components/ui/Badge";
import type { BomComparison, BomEdge, BomPart, BomPlan, BomRelease, BomUsage } from "../contracts";
import { partLabel, releaseLabel, useBomQuantity } from "./display";
import { bomHref } from "./links";
import type { BomWords } from "./messages";

const referenceLink = "font-medium text-primary underline-offset-4 hover:underline";

export function BomWhereUsed({
  part,
  entries,
  siteId,
  t,
}: {
  part: BomPart;
  entries: BomUsage[];
  siteId?: string;
  t: BomWords;
}) {
  const heading = useId();
  return (
    <section className="min-w-0 rounded-lg border bg-card" aria-labelledby={heading}>
      <div className="space-y-1 px-3 py-3">
        <h2 id={heading} className="text-sm font-semibold">
          {t.whereUsed}
        </h2>
        <bdi className="block break-words text-sm text-muted-foreground">{partLabel(part)}</bdi>
      </div>
      {entries.length === 0 ? (
        <p className="px-3 pb-3 text-sm text-muted-foreground">{t.noUsage}</p>
      ) : (
        <ul className="divide-y border-t text-sm">
          {entries.map(({ release, direct, substitute }) => (
            <li
              key={release.id}
              className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2.5"
              data-bom-usage-release={release.id}
              data-bom-usage-direct={direct}
              data-bom-usage-substitute={substitute}
            >
              <Link
                className={`${referenceLink} min-w-0 break-words`}
                href={bomHref({ releaseId: release.id, partId: part.id, siteId })}
                prefetch={false}
              >
                <bdi>{releaseLabel(release, t)}</bdi>
              </Link>
              <div className="flex flex-wrap gap-1">
                <Badge variant="outline">{direct ? t.direct : t.indirect}</Badge>
                {substitute && <Badge variant="outline">{t.alternate}</Badge>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type ComparableEdge = Omit<BomEdge, "releaseId" | "requiredPieces">;

function ComparableLine({
  line,
  releases,
  t,
}: {
  line: ComparableEdge | null;
  releases: BomRelease[];
  t: BomWords;
}) {
  const { number, quantity } = useBomQuantity();
  if (line === null) return "—";
  const entered = quantity(line.enteredQuantity, line.enteredUnit);
  const normalized = quantity(line.primary.quantity, line.primary.unit);
  const pinned = releases.find(({ id }) => id === line.childReleaseId);
  return (
    <div className="space-y-1">
      <p>
        <bdi>{entered}</bdi>
        {entered !== normalized && (
          <span className="text-muted-foreground">
            {" "}
            · <bdi>{normalized}</bdi>
          </span>
        )}
      </p>
      {line.piecesPerParent !== null && (
        <p className="text-xs text-muted-foreground">
          {t.cutsPerAssembly} <bdi>{number(line.piecesPerParent)}</bdi>
        </p>
      )}
      {pinned !== undefined && (
        <Link
          className={`${referenceLink} block text-xs`}
          href={bomHref({ releaseId: pinned.id })}
          prefetch={false}
        >
          <bdi>
            {t.pinnedRelease} {pinned.revision}
          </bdi>
        </Link>
      )}
      <div className="flex flex-wrap gap-1">
        {line.optional && <Badge variant="outline">{t.optional}</Badge>}
        {line.inherited && <Badge variant="outline">{t.inherited}</Badge>}
        {line.consumable && <Badge variant="outline">{t.consumable}</Badge>}
      </div>
      {line.alternatives.length > 0 && (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {line.alternatives.map((alternate) => (
            <li key={alternate.id} className="break-words">
              {t.alternate} ·{" "}
              <bdi>
                {partLabel(alternate)} · {quantity(alternate.quantity, alternate.unit)}
              </bdi>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function BomComparisonView({
  plan,
  comparison,
  t,
}: {
  plan: BomPlan;
  comparison: BomComparison;
  t: BomWords;
}) {
  const heading = useId();
  const cell = "px-3 py-2 text-start align-top";
  const crossPartRevision = comparison.release.part.id !== plan.release.part.id;
  return (
    <section
      className="min-w-0 rounded-lg border bg-card"
      aria-labelledby={heading}
      data-bom-comparison-release={comparison.release.id}
    >
      <div className="space-y-1 px-3 py-3">
        <h2 id={heading} className="text-sm font-semibold">
          {t.comparison}
        </h2>
        <p className="text-xs text-muted-foreground">
          {comparison.release.checksum === null ? (
            t.checksumUnavailable
          ) : (
            <>
              {t.from} · {t.checksum}{" "}
              <code className="break-all" dir="ltr">
                {t.checksumAlgorithm} {comparison.release.checksum}
              </code>
            </>
          )}
        </p>
      </div>
      {comparison.changes.length === 0 ? (
        <p className="px-3 pb-3 text-sm text-muted-foreground">{t.noDifferences}</p>
      ) : (
        <div className="overflow-x-auto border-t">
          <table className="w-full min-w-[28rem] text-sm">
            <thead className="border-b bg-muted/30 text-xs text-muted-foreground">
              <tr>
                <th scope="col" className={`${cell} font-medium`}>
                  {t.part}
                </th>
                <th scope="col" className={`${cell} w-[34%] font-medium`}>
                  {t.from} · <bdi>{comparison.release.revision}</bdi>
                  {crossPartRevision && (
                    <bdi className="block">{partLabel(comparison.release.part)}</bdi>
                  )}
                </th>
                <th scope="col" className={`${cell} w-[34%] font-medium`}>
                  {t.to} · <bdi>{plan.release.revision}</bdi>
                  {crossPartRevision && <bdi className="block">{partLabel(plan.release.part)}</bdi>}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {comparison.changes.map(({ item, before, after }) => (
                <tr
                  key={item.id}
                  data-bom-comparison-item={item.id}
                  data-bom-change={
                    before === null ? "added" : after === null ? "removed" : "changed"
                  }
                >
                  <th scope="row" className={`${cell} font-normal`}>
                    <bdi className="break-words">{partLabel(item)}</bdi>
                  </th>
                  <td className={cell}>
                    <ComparableLine line={before} releases={comparison.subassemblies} t={t} />
                  </td>
                  <td className={cell}>
                    <ComparableLine line={after} releases={plan.subassemblies} t={t} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
