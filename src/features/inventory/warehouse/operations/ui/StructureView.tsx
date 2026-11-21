"use client";

import { PackageMinus, PackagePlus, Unplug } from "lucide-react";
import { type MouseEvent, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { localeTagForFormatting } from "@/lib/localeFormatting";
import { trpc } from "@/lib/trpc-client";
import { CatalogField as Field, CatalogSelect as Select } from "../../../catalog/ui/CatalogFields";
import type { WarehousePosition, WarehouseWorkspace } from "../../contracts";
import { warehouseMessages } from "../../ui/warehouseMessages";
import { operationsMessages } from "./operationsMessages";
import {
  installableComponent,
  installationLabel,
  type StockStructureEditor,
  structurePositionOptions,
} from "./structureDisplay";

type OpenStructureEditor = (
  event: MouseEvent<HTMLButtonElement>,
  editor: StockStructureEditor,
) => void;

export function StockStructureView({
  workspace,
  managedPositions,
  open,
  busy,
}: {
  workspace: WarehouseWorkspace;
  managedPositions: WarehousePosition[];
  open: OpenStructureEditor;
  busy: boolean;
}) {
  const preferences = useLocalePreferences();
  const locale = preferences.locale;
  const t = operationsMessages[locale];
  const language = localeTagForFormatting(preferences);
  const numbers = new Intl.NumberFormat(language);
  const dates = new Intl.DateTimeFormat(language, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: preferences.timeZone,
  });
  const [assemblyId, setAssemblyId] = useState("");
  const assemblies = workspace.positions.filter(
    ({ serial, onHand }) => serial !== null && onHand > 0,
  );
  const assembly = assemblies.find(({ id }) => id === assemblyId);
  const installations = trpc.inventory.warehouse.installations.useQuery(
    { assemblyPositionId: assembly?.id ?? "" },
    { enabled: assembly !== undefined, retry: false, gcTime: 0, refetchOnWindowFocus: false },
  );
  const result = installations.data;
  const loaded = !installations.isError && result?.ok === true ? result.value : null;
  const canManage = loaded?.canManage === true;
  const canDisassemble = loaded?.canDisassemble === true;
  const canInstall =
    assembly !== undefined &&
    canManage &&
    managedPositions.some((position) => installableComponent(assembly, position));
  const disabled = busy || installations.isFetching;

  return (
    <section className="space-y-4 rounded-lg border bg-card p-4" aria-busy={disabled}>
      <div className="max-w-2xl">
        <Field label={t.assemblyPosition}>
          <Select
            ariaLabel={t.assemblyPosition}
            value={assembly?.id ?? ""}
            options={structurePositionOptions(assemblies, workspace, t, numbers)}
            onChange={setAssemblyId}
            disabled={busy || assemblies.length === 0}
          />
        </Field>
      </div>
      {assembly === undefined ? (
        <p className="text-sm text-muted-foreground">
          {assemblies.length === 0 ? t.noAssemblies : t.pickAssembly}
        </p>
      ) : (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">{t.installedComponents}</h2>
            {(canManage || canDisassemble) && (
              <div className="flex flex-wrap items-center gap-2">
                {canDisassemble && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={disabled}
                    onClick={(event) => open(event, { type: "disassembleStock", assembly })}
                  >
                    <Unplug aria-hidden="true" />
                    {t.disassembleStock}
                  </Button>
                )}
                {canManage && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={disabled || !canInstall}
                    onClick={(event) => open(event, { type: "installComponent", assembly })}
                  >
                    <PackagePlus aria-hidden="true" />
                    {t.installComponent}
                  </Button>
                )}
              </div>
            )}
          </div>
          {canManage && !canInstall && (
            <p className="text-sm text-muted-foreground">{t.noInstallableComponents}</p>
          )}
          {loaded === null ? (
            installations.isFetching ? (
              <p role="status" className="text-sm text-muted-foreground">
                {t.loading}
              </p>
            ) : (
              <p role="alert" className="text-sm text-destructive">
                {t.unavailable}
              </p>
            )
          ) : loaded.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.noInstallations}</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {loaded.rows.map((row) => (
                <li
                  key={row.id}
                  data-warehouse-installation-id={row.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      <bdi className="break-words">{installationLabel(row)}</bdi>
                      <Badge variant="outline">
                        {t.quantity} {numbers.format(row.quantity)}
                      </Badge>
                    </div>
                    <p className="flex flex-wrap gap-x-3 gap-y-0.5 break-words text-xs text-muted-foreground">
                      {row.lot !== null && (
                        <span>
                          {t.lot} <bdi>{row.lot}</bdi>
                        </span>
                      )}
                      {row.serial !== null && (
                        <span>
                          {t.serial} <bdi>{row.serial}</bdi>
                        </span>
                      )}
                      {row.expiryDate !== null && (
                        <span>
                          {warehouseMessages[locale].expiryDate} <bdi>{row.expiryDate}</bdi>
                        </span>
                      )}
                      <span>
                        {t.installedAt}{" "}
                        <time dateTime={row.installedAt}>
                          {dates.format(new Date(row.installedAt))}
                        </time>
                      </span>
                    </p>
                  </div>
                  {canManage && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={disabled}
                      onClick={(event) =>
                        open(event, { type: "removeComponent", assembly, installation: row })
                      }
                    >
                      <PackageMinus aria-hidden="true" />
                      {t.removeComponent}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </section>
  );
}
