"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { CatalogField as Field, CatalogSelect as Select } from "../../../catalog/ui/CatalogFields";
import type { WarehouseWorkspace } from "../../contracts";
import { locationOptions, warehousePartLabel, warehouseSiteLabel } from "../../ui/warehouseDisplay";
import { displayMovementKind, isTransferStatus, movementKinds, transferStatuses } from "./display";
import { operationsMessages } from "./operationsMessages";

export type OperationsFilter = {
  search: string;
  itemId: string;
  siteId: string;
  locationId: string;
  kind: string;
  from: string;
  to: string;
  status: string;
};

export type OperationsTab = "history" | "transfers" | "corrections";

export function defaultOperationsFilter(tab: OperationsTab): OperationsFilter {
  return {
    search: "",
    itemId: "",
    siteId: "",
    locationId: "",
    kind: tab === "corrections" ? "correction" : "",
    from: "",
    to: "",
    status: "",
  };
}

export function OperationsFilters({
  tab,
  workspace,
  change,
  initialSearch = "",
}: {
  tab: OperationsTab;
  workspace: WarehouseWorkspace;
  change: (value: OperationsFilter) => void;
  initialSearch?: string;
}) {
  const locale = useLocale();
  const t = operationsMessages[locale];
  const keys = useId();
  const [draft, setDraft] = useState(() => ({
    ...defaultOperationsFilter(tab),
    search: initialSearch,
  }));
  const isTransfer = tab === "transfers";
  const locations = workspace.locations.filter(
    ({ siteId }) => draft.siteId === "" || siteId === draft.siteId,
  );
  const kinds = tab === "corrections" ? ["correction", "correction-reversal"] : movementKinds;
  const all = [{ value: "", label: t.all }];

  const setField = (key: keyof OperationsFilter, value: string) => {
    setDraft((current) =>
      key === "siteId"
        ? { ...current, siteId: value, locationId: "" }
        : { ...current, [key]: value },
    );
  };

  return (
    <form
      className="grid items-end gap-2.5 rounded-lg border bg-card p-3 sm:grid-cols-2 lg:grid-cols-4"
      onSubmit={(event) => {
        event.preventDefault();
        change(draft);
      }}
    >
      <Field id={`${keys}-search`} label={isTransfer ? t.searchTransfers : t.searchMovements}>
        <Input
          id={`${keys}-search`}
          type="search"
          maxLength={160}
          value={draft.search}
          onChange={(event) => setField("search", event.target.value)}
        />
      </Field>
      <Field label={t.part}>
        <Select
          value={draft.itemId}
          options={[
            ...all,
            ...workspace.parts.map((part) => ({ value: part.id, label: warehousePartLabel(part) })),
          ]}
          ariaLabel={t.part}
          onChange={(value) => setField("itemId", value)}
        />
      </Field>
      <Field label={t.site}>
        <Select
          value={draft.siteId}
          options={[
            ...all,
            ...workspace.sites.map((site) => ({ value: site.id, label: warehouseSiteLabel(site) })),
          ]}
          ariaLabel={t.site}
          onChange={(value) => setField("siteId", value)}
        />
      </Field>
      <Field label={t.location}>
        <Select
          value={draft.locationId}
          options={[...all, ...locationOptions(locations, workspace)]}
          ariaLabel={t.location}
          onChange={(value) => setField("locationId", value)}
        />
      </Field>
      {isTransfer ? (
        <Field label={t.status}>
          <Select
            value={draft.status}
            options={[
              ...all,
              ...transferStatuses.map((status) => ({ value: status, label: t[status] })),
            ]}
            ariaLabel={t.status}
            onChange={(value) => setField("status", isTransferStatus(value) ? value : "")}
          />
        </Field>
      ) : (
        <>
          <Field label={t.kind}>
            <Select
              value={draft.kind}
              options={[
                ...(tab === "corrections" ? [] : all),
                ...kinds.map((kind) => ({ value: kind, label: displayMovementKind(kind, locale) })),
              ]}
              ariaLabel={t.kind}
              onChange={(value) => setField("kind", value)}
            />
          </Field>
          <Field id={`${keys}-from`} label={t.from}>
            <Input
              id={`${keys}-from`}
              type="date"
              max={draft.to || undefined}
              value={draft.from}
              onChange={(event) => setField("from", event.target.value)}
            />
          </Field>
          <Field id={`${keys}-to`} label={t.to}>
            <Input
              id={`${keys}-to`}
              type="date"
              min={draft.from || undefined}
              value={draft.to}
              onChange={(event) => setField("to", event.target.value)}
            />
          </Field>
        </>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm">
          {t.apply}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            const next = defaultOperationsFilter(tab);
            setDraft(next);
            change(next);
          }}
        >
          {t.reset}
        </Button>
      </div>
    </form>
  );
}
