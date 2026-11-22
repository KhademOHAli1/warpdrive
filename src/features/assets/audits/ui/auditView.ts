import type {
  EquipmentAuditError,
  EquipmentAuditLookup,
  EquipmentAuditRow,
  EquipmentAuditScope,
} from "../contracts";
import type { AuditWords } from "./messages";

export type AuditScan = Pick<Extract<EquipmentAuditLookup, { ok: true }>, "targetId" | "label"> & {
  code: string;
};

type RowEditor =
  | { type: "undo"; row: EquipmentAuditRow }
  | { type: "note" | "attach"; row: EquipmentAuditRow | null };
export type AuditEditor =
  | { type: "create"; siteId: string }
  | {
      type:
        | "edit"
        | "assign"
        | "start"
        | "bulkCount"
        | "complete"
        | "cancel"
        | "archive"
        | "duplicate"
        | "review";
    }
  | { type: "setCount"; rows: EquipmentAuditRow[]; scan?: AuditScan }
  | { type: "unexpected"; scan: AuditScan }
  | RowEditor;
export type OpenAuditEditor = (trigger: HTMLElement, editor: AuditEditor) => void;

export const emptyAuditScope: EquipmentAuditScope = {
  locationIds: [],
  includeChildren: false,
  assetIds: [],
  kitIds: [],
  categoryIds: [],
  tag: null,
  includeCustody: false,
};

export const auditPhotoMaxBytes = 5 * 1024 * 1024;
export const auditPhotoTypes = ["image/jpeg", "image/png"] as const;

export function auditPhotoAllowed(file: File) {
  return (
    file.size > 0 &&
    file.size <= auditPhotoMaxBytes &&
    auditPhotoTypes.some((type) => file.type === type)
  );
}

export function auditErrorText(error: EquipmentAuditError | "transport", words: AuditWords) {
  if (error === "quantity") return words.quantityError;
  if (error === "storage") return words.storageError;
  return words[error];
}

export function equipmentLabel(row: EquipmentAuditRow, words: AuditWords): string {
  if (row.target === null) return words.unknown;
  const { name, code } = row.target;
  return [name, code, row.serial].filter(Boolean).join(" · ");
}

export function placementLabel(row: EquipmentAuditRow, words: AuditWords) {
  return row.placement.label ?? words[row.placement.kind];
}
