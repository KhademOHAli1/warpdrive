import type { WarehousePosition, WarehouseWorkspace } from "../../contracts";
import type { WarehouseInstallationRow } from "../readContracts";
import { displayStockPosition } from "./display";
import type { OperationsWords } from "./operationsMessages";

export type StockStructureEditor =
  | { type: "splitStock" }
  | { type: "mergeStock" }
  | { type: "installComponent"; assembly: WarehousePosition }
  | { type: "disassembleStock"; assembly: WarehousePosition }
  | {
      type: "removeComponent";
      assembly: WarehousePosition;
      installation: WarehouseInstallationRow;
    };

const maxQuantity = 1_000_000;

export function splitLimit(position: WarehousePosition) {
  return position.serial === null && hasOwnerAccess(position)
    ? Math.min(freeStockLimit(position), position.onHand - 1)
    : 0;
}

function hasOwnerAccess(position: WarehousePosition) {
  return !position.owned || position.ownerOrganizationId !== null;
}

function mergeKey(position: WarehousePosition) {
  if (position.serial !== null || !hasOwnerAccess(position)) {
    return null;
  }
  return JSON.stringify([
    position.locationId,
    position.itemId,
    position.lot,
    position.expiryDate,
    position.state,
    position.ownerOrganizationId,
  ]);
}

export function mergeTargets(positions: WarehousePosition[], source: WarehousePosition) {
  const key = mergeKey(source);
  return key === null
    ? []
    : positions.filter((target) => source.id !== target.id && mergeKey(target) === key);
}

export function mergeSources(positions: WarehousePosition[]) {
  const counts = new Map<string, number>();
  for (const position of positions) {
    const key = mergeKey(position);
    if (key !== null) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return positions.filter((position) => {
    const key = mergeKey(position);
    return key !== null && (counts.get(key) ?? 0) > 1 && freeStockLimit(position) > 0;
  });
}

export function freeStockLimit({ onHand, reserved }: WarehousePosition) {
  return Math.min(maxQuantity, onHand - reserved);
}

export function installableComponent(assembly: WarehousePosition, position: WarehousePosition) {
  return (
    assembly.locationId === position.locationId &&
    assembly.itemId !== position.itemId &&
    position.state === "available" &&
    !position.owned &&
    freeStockLimit(position) > 0
  );
}

export function structurePositionOptions(
  positions: WarehousePosition[],
  workspace: WarehouseWorkspace,
  t: OperationsWords,
  numbers: Intl.NumberFormat,
) {
  const labelCounts = new Map<string, number>();
  const options = positions.map((position) => {
    const label = displayStockPosition(position, workspace, t, numbers);
    labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
    return { value: position.id, label };
  });
  return options.map(({ value, label }) => ({
    value,
    label: (labelCounts.get(label) ?? 0) > 1 ? `${value.slice(0, 8)} · ${label}` : label,
  }));
}

export function installationLabel(row: WarehouseInstallationRow) {
  return `${row.componentCode} · ${row.componentRevision} — ${row.componentName}`;
}
