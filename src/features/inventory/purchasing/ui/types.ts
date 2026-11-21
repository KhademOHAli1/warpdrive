import type { MouseEvent } from "react";
import type { PurchaseOrder, PurchasingIntent } from "../contracts";

export type PurchaseEditor =
  | { type: "draft"; order: PurchaseOrder | null }
  | { type: "issue" | "cancel" | "receive"; order: PurchaseOrder };

export type PurchaseDialogProps = {
  pending: boolean;
  error: string | null;
  close: () => void;
  restoreFocus: () => void;
  save: (intent: PurchasingIntent) => void;
};

export type OpenPurchaseEditor = (
  event: MouseEvent<HTMLButtonElement>,
  editor: PurchaseEditor,
) => void;

export function purchaseOrderHref(siteId: string, orderId?: string): string {
  const query = new URLSearchParams({ siteId });
  if (orderId !== undefined) query.set("orderId", orderId);
  return `/inventory/purchase-orders?${query.toString()}`;
}
