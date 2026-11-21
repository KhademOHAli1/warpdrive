"use client";

import Link from "next/link";
import { type RefObject, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useLocale } from "@/features/i18n/LocaleProvider";
import type {
  WarehousePosition,
  WarehouseWorkspace,
} from "@/features/inventory/warehouse/contracts";
import type {
  CommissionAssetCommand,
  CommissionAssetError,
  CommissionAssetIntent,
  CommissionAssetResult,
  CommissionStockSource,
} from "../contracts";
import { CommissionStockDialog } from "./CommissionStockDialog";
import { commissionStockMessages } from "./messages";

export type CommissionStockAdapter = {
  siteIds: readonly string[];
  submit: (
    command: CommissionAssetCommand,
  ) => Promise<CommissionAssetResult & { workspace?: WarehouseWorkspace }>;
  assetHref?: (assetId: string) => string;
};

export function commissionStockSource(
  workspace: WarehouseWorkspace,
  position: WarehousePosition,
  siteIds: readonly string[],
): CommissionStockSource | null {
  const { id, itemId, siteId, locationId, serial, lot } = position;
  if (!siteIds.includes(siteId) || serial === null || serial === "") return null;
  if (position.state !== "available" || position.owned || position.ownerOrganizationId !== null)
    return null;
  if (position.onHand !== 1 || position.reserved !== 0 || position.available !== 1) return null;

  const site = workspace.sites.find((entry) => entry.id === siteId);
  const location = workspace.locations.find((entry) => entry.id === locationId);
  const part = workspace.parts.find((entry) => entry.id === itemId);
  if (site?.canManage !== true || site.archived || location?.siteId !== siteId) return null;
  if (location.archived || location.kind !== "storage" || part === undefined) return null;

  return {
    positionId: id,
    siteId,
    locationId,
    serial,
    lot,
    partCode: part.code,
    partName: part.name,
    revision: part.revision,
    siteName: site.name,
    locationName: `${location.name} · ${location.code}`,
  };
}

export type OpenCommissionStock = (
  trigger: HTMLButtonElement,
  source: CommissionStockSource,
) => void;

export function CommissionStockButton({
  workspace,
  position,
  busy,
  siteIds,
  open,
}: {
  workspace: WarehouseWorkspace;
  position: WarehousePosition;
  busy: boolean;
  siteIds: readonly string[];
  open: OpenCommissionStock;
}) {
  const t = commissionStockMessages[useLocale()];
  const source = commissionStockSource(workspace, position, siteIds);
  if (source === null) return null;
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={busy}
      onClick={(event) => open(event.currentTarget, source)}
    >
      {t.action}
    </Button>
  );
}

export function useCommissionStock({
  adapter,
  busy,
  positionsTab,
  updateWorkspace,
}: {
  adapter: CommissionStockAdapter | undefined;
  busy: boolean;
  positionsTab: RefObject<HTMLButtonElement | null>;
  updateWorkspace: (workspace: WarehouseWorkspace) => void;
}) {
  const t = commissionStockMessages[useLocale()];
  const [source, setSource] = useState<CommissionStockSource | null>(null);
  const [assetId, setAssetId] = useState<string | null>(null);
  const [error, setError] = useState<CommissionAssetError | "transport" | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const attempts = useRef(new Map<string, string>());
  const trigger = useRef<HTMLButtonElement | null>(null);

  function open(button: HTMLButtonElement, nextSource: CommissionStockSource) {
    trigger.current = button;
    setError(null);
    setAssetId(null);
    setSource(nextSource);
  }

  function close() {
    setError(null);
    setSource(null);
  }

  async function submit(intent: CommissionAssetIntent) {
    if (adapter === undefined || busy || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    const key = JSON.stringify(intent);
    const requestId = attempts.current.get(key) ?? crypto.randomUUID();
    attempts.current.set(key, requestId);
    try {
      const result = await adapter.submit({ ...intent, requestId });
      attempts.current.delete(key);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.workspace !== undefined) updateWorkspace(result.workspace);
      trigger.current = positionsTab.current;
      setAssetId(result.assetId);
      close();
    } catch {
      setError("transport");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  const href = assetId === null ? undefined : adapter?.assetHref?.(assetId);
  return {
    pending,
    row: adapter === undefined ? undefined : { siteIds: adapter.siteIds, open },
    dialog:
      source === null ? null : (
        <CommissionStockDialog
          source={source}
          pending={pending}
          error={error === null ? null : t[error]}
          onClose={close}
          onSubmit={(intent) => void submit(intent)}
          restoreFocus={() => {
            const target = trigger.current;
            (target?.isConnected === true ? target : positionsTab.current)?.focus();
          }}
        />
      ),
    notice:
      assetId === null ? null : (
        <p role="status" className="mb-3 flex flex-wrap gap-x-2 text-sm text-muted-foreground">
          {t.created}
          {href !== undefined && (
            <Link href={href} className="text-foreground underline">
              {t.openAsset}
            </Link>
          )}
        </p>
      ),
  };
}
