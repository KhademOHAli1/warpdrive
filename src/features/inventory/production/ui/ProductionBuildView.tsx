"use client";

import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { bomHref } from "../../bom/ui/links";
import { subcontractMessages } from "../../subcontract/ui/messages";
import { SubcontractPanel } from "../../subcontract/ui/SubcontractPanel";
import { companyProvides, subcontractAllowsCancel } from "../../subcontract/ui/types";
import type { ProductionDetail } from "../contracts";
import type { ProductionMessages } from "./messages";
import { ProductionTime, useProductionNumber } from "./ProductionFields";
import { BuildStatus } from "./ProductionList";
import { ProductionMaterials } from "./ProductionMaterials";
import { ProductionOutputs } from "./ProductionOutputs";
import {
  buildCanChange,
  materialRemaining,
  type OpenProductionEditor,
  productionHref,
} from "./types";

type DetailViewProps = {
  build: ProductionDetail;
  busy: boolean;
  open: OpenProductionEditor;
  t: ProductionMessages;
};

const textLink =
  "rounded-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const buildCommands = {
  planned: ["issue", "schedule", "autoAllocate", "cancelBuild"],
  issued: ["hold", "schedule", "autoAllocate", "cancelBuild"],
  on_hold: ["resume", "schedule", "cancelBuild"],
  closed: [],
  cancelled: [],
} as const satisfies Record<
  ProductionDetail["status"],
  ReadonlyArray<"issue" | "schedule" | "hold" | "resume" | "autoAllocate" | "cancelBuild">
>;

function ProductionHeader({ build, busy, open, t }: DetailViewProps) {
  const number = useProductionNumber();
  const linked = build.subcontract;
  const mayAutoAllocate = build.materials.some(
    (material) =>
      !material.consumable &&
      companyProvides(linked, material) &&
      materialRemaining(material, linked) > 0 &&
      material.positions.some(({ free }) => free > 0),
  );
  const actions = buildCommands[build.status].filter((type) => {
    if (linked === null) return true;
    if (type === "cancelBuild") return subcontractAllowsCancel(build);
    if (type === "autoAllocate")
      return linked.orderStatus !== "cancelled" && linked.companyMaterialIds.length > 0;
    return type === "schedule";
  });
  return (
    <section
      className="space-y-3 rounded-lg border bg-card p-3"
      aria-labelledby="production-build-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 id="production-build-heading" className="break-words text-lg font-semibold">
            <bdi>{build.release.part.name}</bdi>
          </h2>
          <p className="break-words text-sm text-muted-foreground">
            <bdi>
              {build.release.part.code} · {build.release.part.revision}
            </bdi>{" "}
            ·{" "}
            <bdi>
              {build.site} · {build.location}
            </bdi>
          </p>
        </div>
        <BuildStatus status={build.status} t={t} />
      </div>
      <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">{t.engineeringRevision}</dt>
          <dd>
            <Link
              href={bomHref({ releaseId: build.release.id, siteId: build.siteId })}
              prefetch={false}
              className={textLink}
              data-production-release-id={build.release.id}
            >
              <bdi>{build.release.revision}</bdi>
            </Link>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t.target}</dt>
          <dd className="tabular-nums" data-production-planned={build.quantity}>
            <bdi>{number(build.quantity)}</bdi>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t.completed}</dt>
          <dd className="tabular-nums" data-production-completed={build.completed}>
            <bdi>{number(build.completed)}</bdi>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t.scrap}</dt>
          <dd className="tabular-nums" data-production-scrapped={build.scrapped}>
            <bdi>{number(build.scrapped)}</bdi>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t.priority}</dt>
          <dd>{t[build.priority]}</dd>
        </div>
        {build.dueDate !== null && (
          <div>
            <dt className="text-xs text-muted-foreground">{t.dueDate}</dt>
            <dd>
              <ProductionTime value={build.dueDate} dateOnly />
            </dd>
          </div>
        )}
      </dl>
      {buildCanChange(build) && actions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {actions.map((type) => (
            <Button
              key={type}
              size="sm"
              variant={type === "issue" || type === "resume" ? "default" : "outline"}
              data-production-action={type}
              disabled={busy || (type === "autoAllocate" && !mayAutoAllocate)}
              onClick={(event) => open(event, { type, build })}
            >
              {t[type]}
            </Button>
          ))}
        </div>
      )}
    </section>
  );
}

function BuildRelations({ build, t }: { build: ProductionDetail; t: ProductionMessages }) {
  const number = useProductionNumber();
  if (build.parentId === null && build.children.length === 0 && build.project === null) return null;
  return (
    <section
      className="space-y-3 rounded-lg border bg-card p-3"
      aria-labelledby="production-related"
    >
      <h3 id="production-related" className="text-sm font-semibold">
        {t.related}
      </h3>
      {build.parentId !== null && (
        <Link
          href={productionHref({ siteId: build.siteId, buildId: build.parentId })}
          prefetch={false}
          className={`${textLink} text-sm`}
          data-production-parent-id={build.parentId}
        >
          {t.parent}
        </Link>
      )}
      {build.children.length > 0 && (
        <div>
          <h4 className="text-sm font-medium">{t.children}</h4>
          <ul className="mt-1.5 space-y-2">
            {build.children.map((child) => (
              <li
                key={child.id}
                className="flex min-w-0 flex-wrap items-start justify-between gap-2 rounded-md border p-2 text-sm"
              >
                <Link
                  href={productionHref({ siteId: child.siteId, buildId: child.id })}
                  prefetch={false}
                  className={textLink}
                  data-production-child-id={child.id}
                  data-production-release-id={child.release.id}
                >
                  <bdi>
                    {child.release.part.code} · {child.release.revision} — {child.release.part.name}
                  </bdi>
                </Link>
                <div className="flex items-center gap-2">
                  <bdi className="text-xs tabular-nums">
                    {number(child.completed)}/{number(child.quantity)}
                  </bdi>
                  <BuildStatus status={child.status} t={t} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {build.project !== null && (
        <div className="space-y-1.5">
          <h4 className="text-sm font-medium">{t.project}</h4>
          <Link
            href={`/projects/internal/${encodeURIComponent(build.project.id)}`}
            prefetch={false}
            className={`${textLink} text-sm`}
            data-production-project-id={build.project.id}
          >
            <bdi>{build.project.title}</bdi>
          </Link>
          <ul className="space-y-1">
            {build.project.tasks.map((task) => (
              <li key={task.id} className="flex flex-wrap items-center gap-2 text-sm">
                <Link
                  href={`/projects/internal/${encodeURIComponent(build.project?.id ?? "")}?item=${encodeURIComponent(task.id)}`}
                  prefetch={false}
                  className={textLink}
                  data-production-task-id={task.id}
                >
                  <bdi>{task.title}</bdi>
                </Link>
                {task.completed && (
                  <span className="text-xs text-muted-foreground">{t.completed}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function BuildHistory({ build, t }: { build: ProductionDetail; t: ProductionMessages }) {
  const subcontract = subcontractMessages[useLocale()];
  if (build.history.length === 0) return null;
  const labels = { ...t, ...subcontract, createBuild: t.planBuild, deallocate: t.releaseStock };
  return (
    <details className="min-w-0 rounded-lg border bg-card">
      <summary className="cursor-pointer rounded-md p-3 text-sm font-semibold outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50">
        {t.history}
      </summary>
      <ol className="divide-y border-t">
        {build.history.map((entry) => (
          <li key={entry.id} className="space-y-1 p-3" data-production-history-type={entry.type}>
            <div className="flex flex-wrap items-baseline justify-between gap-1 text-sm">
              <span>{labels[entry.type]}</span>
              <span className="text-xs text-muted-foreground">
                <ProductionTime value={entry.at} />
              </span>
            </div>
            {entry.reason !== null && (
              <p className="break-words text-sm text-muted-foreground">
                <bdi>{entry.reason}</bdi>
              </p>
            )}
          </li>
        ))}
      </ol>
    </details>
  );
}

export function ProductionBuildView({ build, busy, open, t }: DetailViewProps) {
  return (
    <article
      className="order-first min-w-0 space-y-3 xl:order-last"
      data-production-build-id={build.id}
      data-production-build-status={build.status}
      data-production-build-version={build.version}
    >
      <ProductionHeader {...{ build, busy, open, t }} />
      <BuildRelations build={build} t={t} />
      <SubcontractPanel {...{ build, busy, open, t }} />
      <ProductionMaterials {...{ build, busy, open, t }} />
      <ProductionOutputs {...{ build, busy, open, t }} />
      <BuildHistory build={build} t={t} />
    </article>
  );
}
