"use client";

import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { SalesInput } from "@/features/inventory/sales/ui/SalesFields";
import type { FormattingLocaleTag } from "@/lib/localeFormatting";
import { EditorSelect, readQuantity } from "../../ui/AssetEditorFields";
import {
  type BookingDemand,
  type BookingKind,
  type BookingResource,
  bookingKinds,
} from "../contracts";
import { bookingKindLabel, pooledBookingKind, resourceLabel } from "./bookingView";
import type { BookingWords } from "./messages";

export type DemandDraft = {
  key: string;
  kind: BookingKind;
  resourceId: string;
  locationId: string;
  quantity: string;
};

export function emptyDemand(key: string): DemandDraft {
  return { key, kind: "asset", resourceId: "", locationId: "", quantity: "1" };
}

export function demandDrafts(lines: BookingDemand[]): DemandDraft[] {
  return lines.map((line, index) => ({
    key: `line-${index}`,
    kind: line.kind,
    resourceId: line.resourceId,
    locationId: line.locationId ?? "",
    quantity: String(line.quantity),
  }));
}

export function readDemand(draft: DemandDraft, locale: FormattingLocaleTag): BookingDemand | null {
  const quantity = readQuantity(draft.quantity, locale);
  if (draft.resourceId === "" || quantity === null || quantity < 1) return null;
  if (pooledBookingKind(draft.kind) && draft.locationId === "") return null;
  return {
    kind: draft.kind,
    resourceId: draft.resourceId,
    locationId: draft.locationId || null,
    quantity,
  };
}

export function BookingDemandRow({
  draft,
  resources,
  pending,
  words: t,
  onChange,
  onRemove,
}: {
  draft: DemandDraft;
  resources: BookingResource[];
  pending: boolean;
  words: BookingWords;
  onChange: (draft: DemandDraft) => void;
  onRemove?: () => void;
}) {
  const { kind, resourceId, locationId } = draft;
  const pooled = pooledBookingKind(kind);
  const choices = resources.filter((row) => row.kind === kind);
  const selected = choices.filter((row) => row.resourceId === resourceId);
  const resourceOptions = [...new Map(choices.map((row) => [row.resourceId, row])).values()].map(
    (row) => ({ value: row.resourceId, label: resourceLabel(row) }),
  );
  const bins = selected.flatMap((row) =>
    row.locationId === null
      ? []
      : [
          {
            value: row.locationId,
            label: row.bin ?? "—",
          },
        ],
  );
  const free = selected.find((row) => row.locationId === (locationId || null))?.freeNow;
  const countable = pooled || kind === "model";
  return (
    <div data-booking-demand-row className="space-y-2 rounded-md border bg-background p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <EditorSelect
          label={t.resourceType}
          value={kind}
          options={bookingKinds.map((value) => ({ value, label: t[bookingKindLabel[value]] }))}
          disabled={pending}
          onChange={(next) => {
            const kind = bookingKinds.find((entry) => entry === next);
            if (kind !== undefined) onChange({ ...emptyDemand(draft.key), kind });
          }}
        />
        <EditorSelect
          label={t.resource}
          value={resourceId}
          options={resourceOptions}
          placeholder={t.chooseResource}
          disabled={pending}
          onChange={(resourceId) => {
            const locationId = pooled
              ? ""
              : (choices.find((row) => row.resourceId === resourceId)?.locationId ?? "");
            onChange({ ...draft, resourceId, locationId });
          }}
        />
        {pooled && (
          <EditorSelect
            label={t.location}
            value={locationId}
            options={bins}
            placeholder={t.chooseLocation}
            disabled={pending}
            onChange={(locationId) => onChange({ ...draft, locationId })}
          />
        )}
        {countable && (
          <SalesInput
            label={t.quantity}
            value={draft.quantity}
            dir="ltr"
            inputMode="numeric"
            maxLength={12}
            required
            disabled={pending}
            onChange={(event) => onChange({ ...draft, quantity: event.currentTarget.value })}
          />
        )}
      </div>
      {free !== undefined && (
        <p className="text-xs text-muted-foreground">
          {t.freeQuantity} <bdi>{free}</bdi>
        </p>
      )}
      {onRemove !== undefined && (
        <Button size="sm" variant="ghost" disabled={pending} onClick={onRemove}>
          <X size={14} aria-hidden="true" /> {t.removeResource}
        </Button>
      )}
    </div>
  );
}

export function BookingResourceFields({
  drafts,
  resources,
  pending,
  words: t,
  onChange,
}: {
  drafts: DemandDraft[];
  resources: BookingResource[];
  pending: boolean;
  words: BookingWords;
  onChange: (drafts: DemandDraft[]) => void;
}) {
  return (
    <fieldset className="space-y-3 rounded-md border p-3">
      <legend className="px-1 text-sm font-medium">{t.resources}</legend>
      {drafts.length === 0 && <p className="text-sm text-muted-foreground">{t.noResources}</p>}
      {drafts.map((draft) => (
        <BookingDemandRow
          key={draft.key}
          {...{ draft, resources, pending }}
          words={t}
          onChange={(next) =>
            onChange(drafts.map((original) => (original.key === draft.key ? next : original)))
          }
          onRemove={() => onChange(drafts.filter(({ key }) => key !== draft.key))}
        />
      ))}
      <Button
        size="sm"
        variant="outline"
        disabled={pending || drafts.length >= 60}
        onClick={() => onChange([...drafts, emptyDemand(crypto.randomUUID())])}
      >
        <Plus size={15} aria-hidden="true" /> {t.addResource}
      </Button>
    </fieldset>
  );
}
