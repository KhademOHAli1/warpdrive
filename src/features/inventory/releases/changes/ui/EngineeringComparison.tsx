"use client";

import { type ReactNode, useId } from "react";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { manufacturingReleaseMessages } from "../../ui/manufacturingReleaseMessages";
import type { ChangeFile, ChangeMaterial, ChangeReview } from "../contracts";
import { type EngineeringLabels, engineeringMessages } from "./messages";

function Difference({
  before,
  after,
  t,
}: {
  before: ReactNode;
  after: ReactNode;
  t: EngineeringLabels;
}) {
  return (
    <dl className="grid min-w-0 grid-cols-2 gap-2">
      <div className="min-w-0">
        <dt className="text-xs text-muted-foreground">{t.before}</dt>
        <dd className="wrap-anywhere">{before ?? t.missing}</dd>
      </div>
      <div className="min-w-0">
        <dt className="text-xs text-muted-foreground">{t.after}</dt>
        <dd className="wrap-anywhere">{after ?? t.missing}</dd>
      </div>
    </dl>
  );
}

function fileDetails(file: ChangeFile | null): ReactNode {
  if (file === null) return null;
  return (
    <>
      <bdi className="block">{file.name}</bdi>
      <bdi dir="ltr" className="block font-mono text-xs text-muted-foreground">
        {file.sha256}
      </bdi>
    </>
  );
}

function materialDetails(line: ChangeMaterial | null, t: EngineeringLabels): ReactNode {
  if (line === null) return null;
  return (
    <div className="space-y-1">
      <bdi dir="ltr">{[line.quantity, line.unit].filter(Boolean).join(" ")}</bdi>
      {line.childRelease !== null && (
        <div className="text-xs text-muted-foreground">
          {t.childRelease} <bdi>{line.childRelease}</bdi>
        </div>
      )}
      {line.alternatives.length > 0 && (
        <div className="text-xs text-muted-foreground">
          {t.alternatives} <bdi>{line.alternatives.join(", ")}</bdi>
        </div>
      )}
    </div>
  );
}

export function EngineeringComparison({ review }: { review: ChangeReview }) {
  const locale = useLocale();
  const t = engineeringMessages[locale];
  const kinds = manufacturingReleaseMessages[locale].kinds;
  const id = useId();
  return (
    <section className="min-w-0 space-y-3" aria-labelledby={id}>
      <h5 id={id} className="text-sm font-semibold">
        {t.comparison}{" "}
        <bdi dir="ltr">
          {review.base.revision} → {review.candidate.revision}
        </bdi>
      </h5>
      <div className="grid min-w-0 gap-3 xl:grid-cols-2">
        <section aria-label={t.design} className="min-w-0 space-y-1.5">
          <h6 className="text-xs font-medium text-muted-foreground">{t.design}</h6>
          {review.design.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t.noDesign}</p>
          ) : (
            <ul className="divide-y rounded-md border bg-muted/20">
              {review.design.map((difference) => (
                <li
                  key={difference.key}
                  data-engineering-design-row={difference.key}
                  className="min-w-0 space-y-1.5 p-2.5 text-xs"
                >
                  <span className="font-medium">{kinds[difference.kind]}</span>
                  <Difference
                    before={fileDetails(difference.before)}
                    after={fileDetails(difference.after)}
                    t={t}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-label={t.materials} className="min-w-0 space-y-1.5">
          <h6 className="text-xs font-medium text-muted-foreground">{t.materials}</h6>
          {review.materials.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t.noMaterials}</p>
          ) : (
            <ul className="divide-y rounded-md border bg-muted/20">
              {review.materials.map((difference) => (
                <li
                  key={difference.key}
                  data-engineering-material-row={difference.key}
                  className="min-w-0 space-y-1.5 p-2.5 text-xs"
                >
                  <bdi className="block font-medium wrap-anywhere">{difference.sku}</bdi>
                  <Difference
                    before={materialDetails(difference.before, t)}
                    after={materialDetails(difference.after, t)}
                    t={t}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <section aria-label={t.whereUsed} className="space-y-1.5" data-engineering-where-used>
        <h6 className="text-xs font-medium text-muted-foreground">{t.whereUsed}</h6>
        {review.whereUsed.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t.noUsage}</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {review.whereUsed.map((usage) => (
              <li
                key={usage.key}
                className="flex flex-wrap items-baseline justify-between gap-x-3 px-2.5 py-1.5 text-xs"
              >
                <bdi className="font-medium wrap-anywhere">
                  {usage.parentSku} · {usage.revision}
                </bdi>
                <bdi className="text-muted-foreground wrap-anywhere">{usage.componentSku}</bdi>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
