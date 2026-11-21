import type { Locale } from "@/features/i18n/registry";
import type { WarehousePosition, WarehouseWorkspace } from "../../contracts";
import { warehouseLocationLabel, warehousePartLabel } from "../../ui/warehouseDisplay";
import type { WarehouseTransferStatus } from "../readContracts";
import { movementKindMessages, type OperationsWords } from "./operationsMessages";

const languageIndex = { en: 0, de: 1, fa: 2 } as const;
export const movementKinds = Object.keys(movementKindMessages);

export function displayMovementKind(kind: string, locale: Locale) {
  const labels = Object.hasOwn(movementKindMessages, kind)
    ? movementKindMessages[kind as keyof typeof movementKindMessages]
    : undefined;
  return labels?.[languageIndex[locale]] ?? kind;
}

export const transferStatuses = ["draft", "in_transit", "received", "cancelled"] as const;

export function isTransferStatus(status: string): status is WarehouseTransferStatus {
  return transferStatuses.some((value) => value === status);
}

export function displayStockPosition(
  position: WarehousePosition,
  workspace: WarehouseWorkspace,
  t: OperationsWords,
  numbers: Intl.NumberFormat,
) {
  const part = workspace.parts.find(({ id }) => id === position.itemId);
  const location = workspace.locations.find(({ id }) => id === position.locationId);
  const identity = part === undefined ? "" : warehousePartLabel(part);
  const bin = location === undefined ? "" : warehouseLocationLabel(location, workspace);
  return [
    identity,
    bin,
    position.lot === null ? "" : `${t.lot} ${position.lot}`,
    position.serial === null ? "" : `${t.serial} ${position.serial}`,
    `${t.onHand} ${numbers.format(position.onHand)}`,
    `${t.free} ${numbers.format(position.onHand - position.reserved)}`,
  ]
    .filter((value) => value !== "")
    .join(" · ");
}
