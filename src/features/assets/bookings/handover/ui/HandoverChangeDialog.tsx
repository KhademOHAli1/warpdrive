"use client";

import { useState } from "react";
import { DatePicker } from "@/components/ui/DatePicker";
import { TimePicker } from "@/components/ui/TimePicker";
import { SalesTextarea } from "@/features/inventory/sales/ui/SalesFields";
import { instantParts, wallTimeToInstant } from "@/lib/zonedDateTime";
import type { BookingHandoverIntent, BookingHandoverView } from "../contracts";
import { HandoverDialog, type HandoverDialogState } from "./HandoverDialog";
import type { HandoverWords } from "./messages";

type Point = ReturnType<typeof instantParts>;

function dueInstant(point: Point, timeZone: string) {
  if (point.date === "" || point.time === "") return null;
  try {
    const value = wallTimeToInstant(point.date, point.time, timeZone);
    return value.ambiguous ? null : value.iso;
  } catch {
    return null;
  }
}

function DueFields({
  point,
  setPoint,
  timeZone,
  invalid,
  pending,
  words: t,
}: {
  point: Point;
  setPoint: (value: Point) => void;
  timeZone: string;
  invalid: boolean;
  pending: boolean;
  words: HandoverWords;
}) {
  return (
    <fieldset disabled={pending} className="min-w-0 space-y-2 rounded-md border p-3">
      <legend className="px-1 text-xs text-muted-foreground">
        <bdi>{timeZone}</bdi>
      </legend>
      <div className="flex flex-wrap gap-2">
        <DatePicker
          value={point.date || null}
          ariaLabel={t.dueDate}
          onChange={(date) => setPoint({ ...point, date: date ?? "" })}
        />
        <TimePicker
          value={point.time}
          ariaLabel={t.dueTime}
          required
          onChange={(time) => setPoint({ ...point, time })}
        />
      </div>
      {invalid && (
        <p role="status" className="text-sm text-muted-foreground">
          {t.invalidDue}
        </p>
      )}
    </fieldset>
  );
}

export function HandoverChangeDialog({
  type,
  view,
  timeZone,
  state,
  words: t,
}: {
  type: "amendDue" | "closePickup";
  view: BookingHandoverView;
  timeZone: string;
  state: HandoverDialogState;
  words: HandoverWords;
}) {
  const [point, setPoint] = useState(() => instantParts(view.dueAt, timeZone));
  const [reason, setReason] = useState("");
  const amend = type === "amendDue";
  const dueAt = amend ? dueInstant(point, timeZone) : null;
  const envelope = {
    bookingId: view.bookingId,
    bookingVersion: view.bookingVersion,
    handoverVersion: view.version,
    reason: reason.trim(),
  };
  const intent: BookingHandoverIntent | null = amend
    ? dueAt === null || dueAt === view.dueAt
      ? null
      : { ...envelope, type, dueAt }
    : { ...envelope, type };
  return (
    <HandoverDialog
      type={type}
      title={amend ? t.startAmend : t.startClose}
      description={amend ? t.amendIntro : t.closeIntro}
      confirm={amend ? t.confirmAmend : t.confirmClose}
      {...{ state, intent, words: t }}
    >
      {amend && (
        <DueFields
          {...{ point, setPoint, timeZone }}
          invalid={dueAt === null}
          pending={state.pending}
          words={t}
        />
      )}
      <SalesTextarea
        label={t.reason}
        required
        value={reason}
        maxLength={500}
        rows={2}
        disabled={state.pending}
        onChange={(event) => setReason(event.currentTarget.value)}
      />
    </HandoverDialog>
  );
}
