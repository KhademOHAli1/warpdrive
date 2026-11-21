"use client";

import { type ReactNode, useState } from "react";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { CatalogEditorDialog } from "@/features/inventory/catalog/ui/CatalogFields";
import { SalesInput, SalesTextarea } from "@/features/inventory/sales/ui/SalesFields";
import {
  type CommissionAssetIntent,
  type CommissionStockSource,
  validCommissionAssetIntent,
} from "../contracts";
import { commissionStockMessages } from "./messages";

function SourceField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words text-sm font-medium">{children}</dd>
    </div>
  );
}

export function CommissionStockDialog({
  source,
  pending,
  error,
  onClose,
  onSubmit,
  restoreFocus,
}: {
  source: CommissionStockSource;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (intent: CommissionAssetIntent) => void;
  restoreFocus?: () => void;
}) {
  const t = commissionStockMessages[useLocale()];
  const { positionId, siteId, locationId, serial, partCode, partName, revision, lot } = source;
  const [code, setCode] = useState(serial.length <= 80 ? serial : "");
  const [name, setName] = useState(partName.length <= 120 ? partName : "");
  const [reason, setReason] = useState("");
  const intent: CommissionAssetIntent = {
    positionId,
    siteId,
    locationId,
    serial,
    lot,
    code: code.trim(),
    name: name.trim(),
    reason: reason.trim(),
  };

  return (
    <CatalogEditorDialog
      title={t.title}
      description={t.description}
      pending={pending}
      error={error}
      close={onClose}
      restoreFocus={() => restoreFocus?.()}
      submitDisabled={!validCommissionAssetIntent(intent)}
      submit={() => onSubmit(intent)}
    >
      <dl className="grid gap-3 rounded-md border bg-background p-3 sm:grid-cols-2">
        <SourceField label={t.part}>
          <bdi>{partCode}</bdi>
          {" · "}
          <bdi>{partName}</bdi>
        </SourceField>
        {revision !== "" && (
          <SourceField label={t.revision}>
            <bdi>{revision}</bdi>
          </SourceField>
        )}
        <SourceField label={t.serial}>
          <bdi>{serial}</bdi>
        </SourceField>
        {lot !== null && (
          <SourceField label={t.lot}>
            <bdi>{lot}</bdi>
          </SourceField>
        )}
        <SourceField label={t.site}>
          <bdi>{source.siteName}</bdi>
        </SourceField>
        <SourceField label={t.location}>
          <bdi>{source.locationName}</bdi>
        </SourceField>
      </dl>
      <div className="grid gap-3 sm:grid-cols-2">
        <SalesInput
          label={t.code}
          value={code}
          maxLength={80}
          disabled={pending}
          onChange={(event) => setCode(event.target.value)}
          dir="ltr"
          required
        />
        <SalesInput
          label={t.name}
          value={name}
          maxLength={120}
          disabled={pending}
          onChange={(event) => setName(event.target.value)}
          required
        />
      </div>
      <SalesTextarea
        label={t.reason}
        value={reason}
        maxLength={400}
        disabled={pending}
        onChange={(event) => setReason(event.target.value)}
        rows={3}
        required
      />
    </CatalogEditorDialog>
  );
}
