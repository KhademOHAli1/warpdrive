"use client";

import { PackagePlus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { CatalogSelect } from "../../catalog/ui/CatalogFields";
import type { ReturnSummary, ReturnsQuery, ReturnsWorkspace } from "../contracts";
import { returnStatusVariants, useReturnDisplay } from "./display";
import type { ReturnMessages } from "./messages";
import { type OpenReturnEditor, returnStatuses, returnsHref } from "./types";

const cell = "px-3 py-2 align-middle";

export function ReturnStatusBadge({
  status,
  t,
}: {
  status: ReturnSummary["status"];
  t: ReturnMessages;
}) {
  return <Badge variant={returnStatusVariants[status]}>{t[status]}</Badge>;
}

function SourceActions({
  workspace,
  busy,
  open,
  t,
}: {
  workspace: ReturnsWorkspace;
  busy: boolean;
  open: OpenReturnEditor;
  t: ReturnMessages;
}) {
  const source = workspace.source;
  if (source === null) {
    return (
      <p className="text-sm text-muted-foreground">
        <Link
          href="/inventory/sales-orders"
          className="text-primary hover:underline"
          prefetch={false}
        >
          {t.salesOrders}
        </Link>
      </p>
    );
  }
  const hasEligible = source.lines.some((line) => line.eligible > 0);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <p className="text-sm text-muted-foreground">
        {t.shipment} <bdi className="font-medium text-foreground">{source.reference}</bdi>
      </p>
      {source.canCreate && hasEligible && (
        <Button
          type="button"
          size="sm"
          data-return-action="saveDraft"
          disabled={busy}
          onClick={(event) => open(event, { type: "saveDraft", detail: null })}
        >
          <PackagePlus aria-hidden="true" className="size-4" />
          {t.newReturn}
        </Button>
      )}
      {source.canCreate && !hasEligible && (
        <p className="text-sm text-muted-foreground">{t.noSourceLines}</p>
      )}
    </div>
  );
}

export function ReturnBrowse({
  workspace,
  scope,
  busy,
  open,
  navigate,
  t,
}: {
  workspace: ReturnsWorkspace;
  scope: ReturnsQuery;
  busy: boolean;
  open: OpenReturnEditor;
  navigate: (next: ReturnsQuery) => void;
  t: ReturnMessages;
}) {
  const [status, statusChange] = useState("");
  const [search, searchChange] = useState("");
  const f = useReturnDisplay();
  const needle = search.trim().toLowerCase();
  const sites = new Map(workspace.sites.map(({ id, name }) => [id, name]));
  const rows = workspace.cases.filter(
    (entry) =>
      (status === "" || status === entry.status) &&
      [entry.reference, entry.shipmentReference, sites.get(entry.siteId) ?? ""].some((part) =>
        part.toLowerCase().includes(needle),
      ),
  );

  return (
    <section className="overflow-hidden rounded-lg border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-3">
        <SourceActions {...{ workspace, busy, open, t }} />
        <div className="grid w-full gap-2 sm:flex sm:w-auto sm:flex-wrap">
          <Input
            aria-label={t.filterText}
            placeholder={t.filterText}
            value={search}
            onChange={(event) => searchChange(event.target.value)}
            className="h-9 sm:w-48"
          />
          {workspace.sites.length > 0 && (
            <div className="sm:w-44">
              <CatalogSelect
                ariaLabel={t.filterSite}
                value={scope.siteId ?? ""}
                options={[
                  { value: "", label: t.allSites },
                  ...workspace.sites.map(({ id, name }) => ({ value: id, label: name })),
                ]}
                onChange={(siteId) =>
                  navigate({ siteId: siteId || undefined, shipmentId: scope.shipmentId })
                }
                disabled={busy}
              />
            </div>
          )}
          <div className="sm:w-36">
            <CatalogSelect
              ariaLabel={t.filterStatus}
              value={status}
              options={[
                { value: "", label: t.allStatuses },
                ...returnStatuses.map((value) => ({ value, label: t[value] })),
              ]}
              onChange={statusChange}
            />
          </div>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">{t.noReturns}</p>
      ) : (
        <div className="overflow-x-auto">
          <table aria-label={t.title} className="w-full min-w-[42rem] text-start text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                {[t.reference, t.shipment, t.site, t.status, t.requested, t.received].map(
                  (label) => (
                    <th scope="col" className={`${cell} text-start font-medium`} key={label}>
                      {label}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((item) => (
                <tr
                  key={item.id}
                  data-return-id={item.id}
                  className={scope.caseId === item.id ? "bg-muted/60" : undefined}
                >
                  <th scope="row" className={`${cell} text-start font-medium`}>
                    <Link
                      href={`${returnsHref({ ...scope, caseId: item.id })}#return-case`}
                      prefetch={false}
                      aria-current={scope.caseId === item.id ? "page" : undefined}
                      className="text-primary hover:underline"
                    >
                      <bdi>{item.reference}</bdi>
                    </Link>
                  </th>
                  <td className={cell}>
                    <bdi>{item.shipmentReference}</bdi>
                  </td>
                  <td className={cell}>
                    <bdi>{sites.get(item.siteId) ?? "—"}</bdi>
                  </td>
                  <td className={cell}>
                    <ReturnStatusBadge status={item.status} t={t} />
                  </td>
                  <td className={`${cell} tabular-nums`}>{f.quantity(item.quantity)}</td>
                  <td className={`${cell} tabular-nums`}>{f.quantity(item.received)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
