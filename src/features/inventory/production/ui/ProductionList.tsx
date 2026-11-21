"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { CatalogField, CatalogSelect } from "../../catalog/ui/CatalogFields";
import type { ProductionBuild, ProductionQuery, ProductionWorkspace } from "../contracts";
import type { ProductionMessages } from "./messages";
import { ProductionTime, useProductionNumber } from "./ProductionFields";
import { productionHref } from "./types";

export function BuildStatus({
  status,
  t,
}: {
  status: ProductionBuild["status"];
  t: ProductionMessages;
}) {
  const variant =
    status === "closed" ? "success" : status === "cancelled" ? "outline" : "secondary";
  return <Badge variant={variant}>{t[status]}</Badge>;
}

export function ProductionList({
  workspace,
  scope,
  busy,
  selectSite,
  t,
}: {
  workspace: ProductionWorkspace;
  scope: ProductionQuery;
  busy: boolean;
  selectSite: (siteId: string | undefined) => void;
  t: ProductionMessages;
}) {
  const number = useProductionNumber();
  return (
    <section
      className="min-w-0 self-start rounded-lg border bg-card"
      aria-labelledby="production-build-list"
    >
      <div className="space-y-3 border-b p-3">
        <h2 className="text-sm font-semibold" id="production-build-list">
          {t.builds}
        </h2>
        {workspace.sites.length > 0 && (
          <CatalogField label={t.site}>
            <CatalogSelect
              ariaLabel={t.site}
              value={scope.siteId ?? ""}
              options={[
                { value: "", label: t.allSites },
                ...workspace.sites.map(({ id, name, code }) => ({
                  value: id,
                  label: `${code} · ${name}`,
                })),
              ]}
              onChange={(id) => selectSite(id === "" ? undefined : id)}
              disabled={busy}
            />
          </CatalogField>
        )}
      </div>
      {workspace.builds.length === 0 ? (
        <p className="p-3 text-sm text-muted-foreground">
          {workspace.sites.length === 0 ? t.noSites : t.noBuilds}
        </p>
      ) : (
        <ul className="divide-y">
          {workspace.builds.map((build) => (
            <li key={build.id}>
              <Link
                href={productionHref({ buildId: build.id, siteId: scope.siteId })}
                prefetch={false}
                aria-current={workspace.detail?.id === build.id ? "page" : undefined}
                className="block min-w-0 p-3 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50 aria-[current=page]:bg-accent"
                data-production-build-link={build.id}
                data-production-build-status={build.status}
                data-production-release-id={build.release.id}
              >
                <span className="flex flex-wrap items-start justify-between gap-2">
                  <bdi className="min-w-0 break-words text-sm font-medium">
                    {build.release.part.name}
                  </bdi>
                  <BuildStatus status={build.status} t={t} />
                </span>
                <span className="mt-1 block break-words text-xs text-muted-foreground">
                  <bdi>
                    {build.release.part.code} · {build.release.revision}
                  </bdi>{" "}
                  · <bdi>{build.site}</bdi>
                </span>
                <span className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <bdi className="tabular-nums">
                    {number(build.completed)}/{number(build.quantity)}
                  </bdi>
                  <span>{t[build.priority]}</span>
                  {build.dueDate !== null && <ProductionTime value={build.dueDate} dateOnly />}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
