import type { MouseEvent } from "react";
import {
  type ReturnCommand,
  type ReturnDetail,
  type ReturnsQuery,
  returnCommand,
} from "../contracts";

type WithoutRequest<T> = T extends ReturnCommand ? Omit<T, "requestId"> : never;
export type ReturnIntent = WithoutRequest<ReturnCommand>;
export type ReturnLine = ReturnDetail["lines"][number];
export type ReturnReceipt = ReturnLine["receipts"][number];

type Lifecycle = "issue" | "hold" | "resume" | "duplicate" | "cancel" | "complete";
type LifecycleEditor<T> = T extends Lifecycle ? { type: T; detail: ReturnDetail } : never;

export type ReturnEditor =
  | { type: "saveDraft"; detail: ReturnDetail | null }
  | LifecycleEditor<Lifecycle>
  | { type: "receive"; detail: ReturnDetail; line: ReturnLine }
  | { type: "disposition"; detail: ReturnDetail; receipt: ReturnReceipt }
  | { type: "commercial"; detail: ReturnDetail; receipt: ReturnReceipt };

export type OpenReturnEditor = (event: MouseEvent<HTMLButtonElement>, editor: ReturnEditor) => void;
export type ReturnDialog = {
  pending: boolean;
  error: string | null;
  close: () => void;
  restoreFocus: () => void;
  save: (intent: ReturnIntent) => void;
};

export const returnStatuses = ["draft", "issued", "onHold", "completed", "cancelled"] as const;

export function returnsHref(query: ReturnsQuery) {
  const params = new URLSearchParams();
  if (query.siteId !== undefined) params.set("siteId", query.siteId);
  if (query.caseId !== undefined) params.set("caseId", query.caseId);
  if (query.shipmentId !== undefined) params.set("shipmentId", query.shipmentId);
  return params.size === 0 ? "/inventory/returns" : `/inventory/returns?${params}`;
}

export function returnCaseVersion(detail: ReturnDetail) {
  return { caseId: detail.id, version: detail.version };
}

export function validReturnIntent(intent: ReturnIntent) {
  return returnCommand.safeParse({ ...intent, requestId: "00000000-0000-4000-8000-000000000000" })
    .success;
}

export function canSetPhysicalDisposition(receipt: ReturnReceipt) {
  return receipt.physical === "quarantine" || receipt.physical === "repair";
}

export function returnLifecycle(detail: ReturnDetail): Record<Lifecycle, boolean> {
  return {
    issue: detail.canEdit && detail.status === "draft" && detail.lines.length > 0,
    hold: detail.canEdit && detail.status === "issued",
    resume: detail.canEdit && detail.status === "onHold",
    duplicate: detail.canDuplicate,
    cancel: detail.canCancel,
    complete: detail.canComplete === true,
  };
}
