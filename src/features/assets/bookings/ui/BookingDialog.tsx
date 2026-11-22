"use client";

import type { ReactNode } from "react";
import { CatalogEditorDialog } from "@/features/inventory/catalog/ui/CatalogFields";
import {
  type Booking,
  type BookingIntent,
  type BookingMaintenance,
  type BookingsWorkspace,
  validBookingIntent,
} from "../contracts";
import type { BookingWords } from "./messages";

export type BookingAction =
  | "submit"
  | "approve"
  | "sendBack"
  | "deny"
  | "cancel"
  | "archive"
  | "restore";

export type BookingEditor =
  | { type: "edit"; siteId: string; booking?: Booking }
  | { type: "duplicate"; siteId: string; booking: Booking }
  | { type: "action"; siteId: string; booking: Booking; action: BookingAction }
  | { type: "policy"; siteId: string }
  | { type: "maintenance"; siteId: string; maintenance?: BookingMaintenance }
  | { type: "removeMaintenance"; siteId: string; maintenance: BookingMaintenance };

export type OpenBookingEditor = (trigger: HTMLElement, editor: BookingEditor) => void;

export type BookingDialogState = {
  pending: boolean;
  error: string | null;
  close: () => void;
  save: (intent: BookingIntent) => void;
  restoreFocus: () => void;
};

export type BookingEditorProps = {
  workspace: BookingsWorkspace;
  state: BookingDialogState;
  words: BookingWords;
};

export function BookingDialog({
  state,
  intent,
  title,
  description,
  children,
}: {
  state: BookingDialogState;
  intent: BookingIntent | null;
  title: string;
  description: string;
  children: ReactNode;
}) {
  const valid = intent !== null && validBookingIntent(intent);
  return (
    <CatalogEditorDialog
      title={title}
      description={description}
      pending={state.pending}
      error={state.error}
      close={state.close}
      restoreFocus={state.restoreFocus}
      submitDisabled={!valid}
      submit={() => {
        if (valid) state.save(intent);
      }}
    >
      {children}
    </CatalogEditorDialog>
  );
}

export function bookingVersion({ id, siteId, version }: Booking) {
  return { bookingId: id, siteId, version };
}
