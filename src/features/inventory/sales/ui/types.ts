import type { MouseEvent } from "react";
import {
  type SalesCommand,
  type SalesOrderDetail,
  type SalesOrderLine,
  type SalesOrderSummary,
  type SalesQuery,
  type SalesShipment,
  salesCommand,
} from "../contracts";

type WithoutRequest<T> = T extends SalesCommand ? Omit<T, "requestId"> : never;
export type SalesIntent = WithoutRequest<SalesCommand>;
export type SalesView = "list" | "calendar";
type SalesOrderAction =
  | "issueOrder"
  | "cancelOrder"
  | "reschedule"
  | "autoAllocate"
  | "createShipment";
export type Allocation = SalesOrderLine["allocations"][number];

type EditorForAction<T extends string> = T extends string
  ? { type: T; order: SalesOrderDetail }
  : never;

export type SalesEditor =
  | { type: "saveDraft"; order: SalesOrderDetail | null }
  | EditorForAction<SalesOrderAction>
  | { type: "allocate"; order: SalesOrderDetail; line: SalesOrderLine }
  | { type: "deallocate"; order: SalesOrderDetail; allocation: Allocation }
  | {
      type: "checkShipmentLine";
      order: SalesOrderDetail;
      shipment: SalesShipment;
      line: SalesShipment["lines"][number];
    }
  | { type: "postShipment"; order: SalesOrderDetail; shipment: SalesShipment }
  | { type: "cancelShipment"; order: SalesOrderDetail; shipment: SalesShipment };

export type OpenSalesEditor = (event: MouseEvent<HTMLButtonElement>, editor: SalesEditor) => void;
export type SalesDialog = {
  pending: boolean;
  error: string | null;
  close: () => void;
  restoreFocus: () => void;
  save: (intent: SalesIntent) => void;
};

export function salesOrderHref(query: SalesQuery, view: SalesView, day?: string): string {
  const params = new URLSearchParams();
  if (query.siteId !== undefined) params.set("siteId", query.siteId);
  if (query.dealId !== undefined) params.set("dealId", query.dealId);
  if (query.orderId !== undefined) params.set("orderId", query.orderId);
  if (view === "calendar") {
    params.set("view", view);
    if (day !== undefined) params.set("day", day);
  }
  return params.size === 0 ? "/inventory/sales-orders" : `/inventory/sales-orders?${params}`;
}

export function validSalesIntent(intent: SalesIntent) {
  return salesCommand.safeParse({ ...intent, requestId: "00000000-0000-4000-8000-000000000000" })
    .success;
}

export function displayStatus(order: SalesOrderSummary) {
  return order.status === "issued" && order.shipped > 0 ? "partial" : order.status;
}

export function isOverdue(order: SalesOrderSummary, today: string) {
  return order.status === "issued" && order.dueDate !== null && order.dueDate < today;
}
