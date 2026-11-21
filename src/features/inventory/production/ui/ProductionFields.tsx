"use client";

import { useId } from "react";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { useFormatters } from "@/lib/useFormatters";
import { useHydrated } from "@/lib/useHydrated";
import { normalizeDigits } from "@/utils/normalizeNumberInput";
import { CatalogField, CatalogSelect } from "../../catalog/ui/CatalogFields";
import { type ProductionPriority, productionPriorities } from "../contracts";
import type { ProductionMessages } from "./messages";

export type BuildSchedule = { priority: ProductionPriority; dueDate: string };

export function parsedQuantity(value: string, maximum: number) {
  const digits = normalizeDigits(value.trim());
  if (!/^\d{1,7}$/.test(digits)) return null;
  const count = Number(digits);
  return count >= 1 && count <= maximum ? count : null;
}

export function ProductionQuantityField({
  label,
  value,
  change,
  disabled,
  required = true,
}: {
  label: string;
  value: string;
  change: (value: string) => void;
  disabled: boolean;
  required?: boolean;
}) {
  const id = useId();
  return (
    <CatalogField id={id} label={label}>
      <Input
        id={id}
        required={required}
        inputMode="numeric"
        value={value}
        maxLength={7}
        onChange={(event) => change(normalizeDigits(event.target.value))}
        disabled={disabled}
      />
    </CatalogField>
  );
}

export function ProductionReasonField({
  reason,
  change,
  pending,
  label,
}: {
  reason: string;
  change: (reason: string) => void;
  pending: boolean;
  label: string;
}) {
  const id = useId();
  return (
    <CatalogField id={id} label={label}>
      <Textarea
        id={id}
        value={reason}
        onChange={(event) => change(event.target.value)}
        maxLength={500}
        disabled={pending}
        required
      />
    </CatalogField>
  );
}

export function ProductionScheduleFields({
  value,
  change,
  pending,
  t,
}: {
  value: BuildSchedule;
  change: (next: BuildSchedule) => void;
  pending: boolean;
  t: ProductionMessages;
}) {
  const dueDateId = useId();
  return (
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">
      <CatalogField label={t.priority}>
        <CatalogSelect
          ariaLabel={t.priority}
          value={value.priority}
          options={productionPriorities.map((priority) => ({
            value: priority,
            label: t[priority],
          }))}
          onChange={(priority) => {
            const next = productionPriorities.find((option) => option === priority);
            if (next !== undefined) change({ ...value, priority: next });
          }}
          disabled={pending}
        />
      </CatalogField>
      <CatalogField id={dueDateId} label={t.dueDate}>
        <Input
          id={dueDateId}
          type="date"
          min="0001-01-01"
          max="9999-12-31"
          value={value.dueDate}
          onChange={(event) => change({ ...value, dueDate: event.target.value })}
          disabled={pending}
        />
      </CatalogField>
    </div>
  );
}

export function useProductionNumber() {
  const { number } = useFormatters();
  const hydrated = useHydrated();
  return (value: number) => (hydrated ? number(value) : String(value));
}

export function ProductionTime({ value, dateOnly = false }: { value: string; dateOnly?: boolean }) {
  const { dateOnly: formatDate, dateTime } = useFormatters();
  const hydrated = useHydrated();
  return (
    <time dateTime={value}>
      {hydrated ? (dateOnly ? formatDate(value) : dateTime(value)) : value.slice(0, 10)}
    </time>
  );
}
