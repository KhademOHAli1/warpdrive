"use client";

import { useId } from "react";
import { Badge } from "@/components/ui/Badge";
import { Select } from "@/components/ui/Select";
import { useLocale, useNumberingSystem } from "@/features/i18n/LocaleProvider";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { useHydrated } from "@/lib/useHydrated";
import type { QualityPlanVersion, QualityStepDraft } from "../../quality/contracts";
import { QualityPlanEditor } from "./QualityPlanEditor";
import { qualityPlanMessages } from "./qualityPlanMessages";

export function ReleaseQualityPlan({
  pinnedId,
  pinned,
  versions,
  pending,
  edit,
}: {
  pinnedId: string | null;
  pinned: QualityPlanVersion | undefined;
  versions: QualityPlanVersion[];
  pending: boolean;
  edit?: {
    select: (id: string | null) => void;
    create: (name: string, steps: QualityStepDraft[], requestId: string) => Promise<boolean>;
  };
}) {
  const locale = useLocale();
  const t = qualityPlanMessages[locale];
  const numberingSystem = useNumberingSystem();
  const hydrated = useHydrated();
  const formatter = new Intl.NumberFormat(locale, {
    numberingSystem,
    maximumSignificantDigits: 21,
  });
  const number = (value: number) => (hydrated ? formatter.format(value) : String(value));
  const headingId = useId();
  return (
    <section className="space-y-2" aria-labelledby={headingId}>
      <h4 id={headingId} className="text-sm font-semibold">
        {t.heading}
      </h4>
      {pinned === undefined && pinnedId !== null && (
        <p role="alert" className="text-sm text-destructive">
          {t.unavailable}
        </p>
      )}
      {pinnedId === null && (edit === undefined || versions.length === 0) && (
        <p className="text-sm text-muted-foreground">{t.none}</p>
      )}
      {pinned !== undefined && (
        <div
          className="space-y-2 rounded-md border px-3 py-2"
          data-release-quality-plan-id={pinned.id}
        >
          <p className="break-words text-sm font-medium">
            <bdi>{t.version(pinned.name, number(pinned.version))}</bdi>
          </p>
          <ul className="divide-y">
            {pinned.steps.map((step) => (
              <li
                key={step.key}
                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-1 text-sm"
              >
                <bdi className="min-w-0 break-words">{step.label}</bdi>
                <div className="flex min-w-0 flex-wrap items-baseline gap-2">
                  {step.kind === "check" ? (
                    <span className="text-muted-foreground">{t.check}</span>
                  ) : (
                    <dl className="flex min-w-0 flex-wrap gap-x-2 text-muted-foreground">
                      {step.minimum !== null && (
                        <div className="flex gap-1">
                          <dt>{t.minimum}</dt>
                          <dd>
                            <bdi>{number(step.minimum)}</bdi>
                          </dd>
                        </div>
                      )}
                      {step.maximum !== null && (
                        <div className="flex gap-1">
                          <dt>{t.maximum}</dt>
                          <dd>
                            <bdi>{number(step.maximum)}</bdi>
                          </dd>
                        </div>
                      )}
                      <div>
                        <dt className="sr-only">{t.unit}</dt>
                        <dd>
                          <bdi className="break-words">{step.unit}</bdi>
                        </dd>
                      </div>
                    </dl>
                  )}
                  {step.evidenceRequired && <Badge variant="secondary">{t.evidenceRequired}</Badge>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {edit !== undefined && versions.length > 0 && (
        <div className="grid gap-1">
          <span className="text-xs font-medium">{t.select}</span>
          <Select
            value={pinnedId ?? ""}
            onChange={(value) => edit.select(value === "" ? null : value)}
            options={[
              { value: "", label: t.none },
              ...versions.map((plan) => ({
                value: plan.id,
                label: t.version(plan.name, number(plan.version)),
              })),
            ]}
            ariaLabel={t.select}
            contentClassName={`${BLOCK_CLASS} ph-no-capture max-h-72 overflow-y-auto`}
            disabled={pending}
          />
        </div>
      )}
      {edit !== undefined && (
        <QualityPlanEditor initial={pinned} pending={pending} create={edit.create} />
      )}
    </section>
  );
}
