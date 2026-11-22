import type { BookingCapacityGuard } from "../bookings/protection";
import type { AssetBalance, AssetEvent, AssetRecord, AssetsWorkspace } from "../contracts";
import { kitUsesAsset } from "../kits/usage";
import {
  type Custodian,
  type CustodyCommand,
  type CustodyError,
  type CustodyEvent,
  type CustodyHolding,
  type CustodyOutcome,
  type CustodyResult,
  type CustodyWorkspace,
  custodyCommand,
  emptyCustodyWorkspace,
} from "./contracts";

type Workspace = AssetsWorkspace & { custody: CustodyWorkspace };
type Single = Extract<CustodyCommand, { assetId: string }>;
type Assign = Extract<Single, { type: "assign" }>;
type Transfer = Extract<Single, { type: "transfer" }>;
type Return = Extract<Single, { type: "return" }>;
type Bulk = Extract<CustodyCommand, { assets: unknown }>;
type CustodianCommand = Extract<CustodyCommand, { type: "saveCustodian" | "noteCustodian" }>;
type Transition = {
  record: AssetRecord;
  sourceLocationId: string | null;
  locationId: string | null;
} & (
  | { previous: null; destination: CustodyHolding }
  | { previous: CustodyHolding; destination: CustodyHolding | null }
);

const limit = 1_000_000;

function failure(error: CustodyError): CustodyResult {
  return { ok: false, error };
}

function success(value: Workspace, outcomes: CustodyOutcome[] = []): CustodyResult {
  return { ok: true, value, outcomes };
}

function activeLocation(workspace: Workspace, siteId: string, id: string | null) {
  return (
    id === null ||
    workspace.locations.some(
      ({ id: locationId, siteId: locationSite, archived }) =>
        locationId === id && locationSite === siteId && !archived,
    )
  );
}

function custodian(workspace: Workspace, siteId: string, id: string) {
  return workspace.custody.custodians.find((row) => row.id === id && row.siteId === siteId);
}

function recipient(workspace: Workspace, siteId: string, id: string) {
  const row = custodian(workspace, siteId, id);
  if (row?.active !== true) return undefined;
  if (row.kind === "non_login" && row.staffId === null) return row;
  const staff = workspace.custody.staff.find(({ id }) => id === row.staffId);
  return staff === undefined ? undefined : { ...row, name: staff.name };
}

function saveCustodian(
  workspace: Workspace,
  command: Extract<CustodianCommand, { type: "saveCustodian" }>,
): CustodyResult {
  const { siteId, custodianId, staffId, version, active } = command;
  const current = custodianId === null ? undefined : custodian(workspace, siteId, custodianId);
  if (custodianId !== null && current === undefined) return failure("unavailable");
  if ((current?.version ?? null) !== version) return failure("stale");
  if (current !== undefined && current.staffId !== staffId) return failure("invalid");
  const kind = current?.kind ?? (staffId === null ? "non_login" : "staff");
  let name = command.name;
  if (kind === "staff") {
    const staff = workspace.custody.staff.find(({ id }) => id === staffId);
    if (staff === undefined && (current === undefined || active)) return failure("unavailable");
    name = staff?.name ?? current?.name ?? null;
  }
  if (
    current === undefined &&
    staffId !== null &&
    workspace.custody.custodians.some((row) => row.siteId === siteId && row.staffId === staffId)
  )
    return failure("conflict");
  if (name === null) return failure("invalid");
  const updated: Custodian = {
    id: current?.id ?? crypto.randomUUID(),
    siteId,
    name,
    kind,
    staffId,
    active,
    version: (current?.version ?? 0) + 1,
  };
  const custodians =
    current === undefined
      ? [...workspace.custody.custodians, updated]
      : workspace.custody.custodians.map((row) => (row.id === current.id ? updated : row));
  return success({ ...workspace, custody: { ...workspace.custody, custodians } });
}

function noteCustodian(
  workspace: Workspace,
  command: Extract<CustodianCommand, { type: "noteCustodian" }>,
  actor: string,
): CustodyResult {
  const { siteId, custodianId, note } = command;
  if (custodian(workspace, siteId, custodianId) === undefined) return failure("unavailable");
  const entry = {
    id: crypto.randomUUID(),
    siteId,
    custodianId,
    note,
    actor,
    at: new Date().toISOString(),
  };
  return success({
    ...workspace,
    custody: { ...workspace.custody, notes: [entry, ...workspace.custody.notes] },
  });
}

function balanceAt(balances: AssetBalance[], locationId: string) {
  return balances.find((row) => row.locationId === locationId)?.quantity ?? 0;
}

function setBalance(balances: AssetBalance[], locationId: string, quantity: number) {
  const others = balances.filter((row) => row.locationId !== locationId);
  return quantity === 0 ? others : [...others, { locationId, quantity }];
}

function assetHoldings(workspace: Workspace, asset: AssetRecord) {
  return workspace.custody.holdings.filter(
    ({ assetId, siteId }) => assetId === asset.id && siteId === asset.siteId,
  );
}

function newHolding(
  command: Assign | Transfer,
  to: Custodian,
  sourceLocationId: string | null,
  locationId: string | null,
  at: string,
): CustodyHolding {
  return {
    id: crypto.randomUUID(),
    siteId: command.siteId,
    assetId: command.assetId,
    custodianId: to.id,
    custodianName: to.name,
    quantity: command.quantity,
    sourceLocationId,
    locationId,
    condition: command.condition,
    assignedAt: at,
  };
}

function assign(
  workspace: Workspace,
  asset: AssetRecord,
  command: Assign,
  at: string,
): Transition | CustodyError {
  const to = recipient(workspace, asset.siteId, command.custodianId);
  if (to === undefined) return "unavailable";
  const source = asset.tracking === "individual" ? asset.locationId : command.locationId;
  const location = command.locationId ?? source;
  if (
    !activeLocation(workspace, asset.siteId, source) ||
    !activeLocation(workspace, asset.siteId, location)
  )
    return "unavailable";
  const destination = newHolding(command, to, source, location, at);
  const effect = { previous: null, destination, sourceLocationId: source, locationId: location };
  if (asset.tracking === "individual") {
    if (assetHoldings(workspace, asset).length > 0) return "held";
    return { ...effect, record: asset };
  }
  if (source === null) return "invalid";
  const remaining = balanceAt(asset.balances, source) - command.quantity;
  if (remaining < 0) return "quantity";
  return {
    ...effect,
    record: { ...asset, balances: setBalance(asset.balances, source, remaining) },
  };
}

function transfer(
  workspace: Workspace,
  asset: AssetRecord,
  command: Transfer,
  previous: CustodyHolding,
  at: string,
): Transition | CustodyError {
  const to = recipient(workspace, asset.siteId, command.custodianId);
  if (to === undefined) return "unavailable";
  if (to.id === previous.custodianId) return "conflict";
  if (!activeLocation(workspace, asset.siteId, command.locationId)) return "unavailable";
  const { sourceLocationId } = previous;
  const locationId = command.locationId ?? previous.locationId;
  const destination = newHolding(command, to, sourceLocationId, locationId, at);
  return { record: asset, previous, destination, sourceLocationId, locationId };
}

function returnToStorage(
  workspace: Workspace,
  asset: AssetRecord,
  command: Return,
  previous: CustodyHolding,
): Transition | CustodyError {
  const { sourceLocationId } = previous;
  const locationId = command.locationId ?? sourceLocationId;
  if (!activeLocation(workspace, asset.siteId, locationId)) return "unavailable";
  const effect = { previous, destination: null, sourceLocationId, locationId };
  if (asset.tracking === "individual") return { ...effect, record: { ...asset, locationId } };
  if (locationId === null) return "ineligible";
  const quantity = balanceAt(asset.balances, locationId) + command.quantity;
  if (quantity > limit) return "quantity";
  return {
    ...effect,
    record: { ...asset, balances: setBalance(asset.balances, locationId, quantity) },
  };
}

function changeHolding(
  workspace: Workspace,
  asset: AssetRecord,
  command: Single,
  at: string,
): Transition | CustodyError {
  if (command.type === "assign") return assign(workspace, asset, command, at);
  const previous = assetHoldings(workspace, asset).find(({ id }) => id === command.holdingId);
  if (previous === undefined) return "unavailable";
  if (command.quantity > previous.quantity) return "quantity";
  if (asset.tracking === "individual" && previous.quantity !== 1) return "ineligible";
  return command.type === "transfer"
    ? transfer(workspace, asset, command, previous, at)
    : returnToStorage(workspace, asset, command, previous);
}

function updateHoldings(
  holdings: CustodyHolding[],
  { previous, destination }: Transition,
  quantity: number,
) {
  const next = holdings.filter(({ id }) => id !== previous?.id);
  if (previous !== null && previous.quantity > quantity) {
    next.push({ ...previous, quantity: previous.quantity - quantity });
  }
  if (destination !== null) next.push(destination);
  return next;
}

type Audit = { actor: string; at: string };

function custodyHistory(
  command: Single,
  effect: Transition,
  audit: Audit,
): { event: AssetEvent; detail: CustodyEvent } {
  const { previous, destination, sourceLocationId, locationId, record } = effect;
  const id = crypto.randomUUID();
  const { note, quantity } = command;
  return {
    event: {
      ...audit,
      id,
      kind: "updated",
      reason: note,
      fromLocationId: previous?.locationId ?? sourceLocationId,
      locationId,
      quantity,
    },
    detail: {
      ...audit,
      id,
      siteId: record.siteId,
      assetId: record.id,
      version: record.version + 1,
      action: command.type,
      holdingId: previous === null ? destination.id : previous.id,
      destinationHoldingId: previous === null ? null : (destination?.id ?? null),
      fromCustodianId: previous?.custodianId ?? null,
      fromCustodianName: previous?.custodianName ?? null,
      toCustodianId: destination?.custodianId ?? null,
      toCustodianName: destination?.custodianName ?? null,
      quantity,
      sourceLocationId,
      locationId,
      condition: command.condition,
      note,
    },
  };
}

function applySingle(
  workspace: Workspace,
  asset: AssetRecord,
  command: Single,
  audit: Audit,
): CustodyResult {
  if (asset.version !== command.version) return failure("stale");
  if (asset.archivedAt !== null || asset.tracking === "consumable_pool")
    return failure("ineligible");
  if (asset.tracking === "individual" && command.quantity !== 1) return failure("quantity");
  if (asset.tracking === "individual" && kitUsesAsset(workspace.kits, asset.id))
    return failure("held");
  const effect = changeHolding(workspace, asset, command, audit.at);
  if (typeof effect === "string") return failure(effect);
  const { event, detail } = custodyHistory(command, effect, audit);
  const updated = { ...effect.record, version: detail.version, events: [event, ...asset.events] };
  return success({
    ...workspace,
    records: workspace.records.map((row) => (row.id === asset.id ? updated : row)),
    custody: {
      ...workspace.custody,
      holdings: updateHoldings(workspace.custody.holdings, effect, command.quantity),
      events: [detail, ...workspace.custody.events],
    },
  });
}

function siteAsset(workspace: Workspace, siteId: string, assetId: string) {
  return workspace.records.find(
    ({ id, siteId: recordSite }) => id === assetId && recordSite === siteId,
  );
}

function bulkRow(
  workspace: Workspace,
  command: Bulk,
  { assetId, version }: Bulk["assets"][number],
  audit: Audit,
): CustodyResult {
  const asset = siteAsset(workspace, command.siteId, assetId);
  if (asset === undefined) return failure("unavailable");
  if (asset.tracking !== "individual" || asset.archivedAt !== null) return failure("ineligible");
  if (asset.version !== version) return failure("stale");
  const { siteId, requestId, locationId, condition, note } = command;
  const common = { siteId, requestId, locationId, condition, note, assetId, version, quantity: 1 };
  if (command.type === "bulkAssign") {
    return applySingle(
      workspace,
      asset,
      { ...common, type: "assign", custodianId: command.custodianId },
      audit,
    );
  }
  const [holding] = assetHoldings(workspace, asset);
  if (holding === undefined) return failure("ineligible");
  return applySingle(workspace, asset, { ...common, type: "return", holdingId: holding.id }, audit);
}

function applyBulk(
  workspace: Workspace,
  command: Bulk,
  audit: Audit,
  booking?: BookingCapacityGuard,
): CustodyResult {
  let value = workspace;
  const outcomes: CustodyOutcome[] = [];
  for (const selected of command.assets) {
    const result = bulkRow(value, command, selected, audit);
    if (result.ok) {
      if (booking?.(result.value) === false) {
        outcomes.push({ assetId: selected.assetId, ok: false, error: "held" });
      } else {
        value = result.value;
        outcomes.push({ assetId: selected.assetId, ok: true });
      }
    } else {
      outcomes.push({ assetId: selected.assetId, ok: false, error: result.error });
    }
  }
  return success(value, outcomes);
}

export function applyCustodyCommand(
  workspace: AssetsWorkspace,
  input: CustodyCommand,
  actor: string,
  booking?: BookingCapacityGuard,
): CustodyResult {
  const parsed = custodyCommand.safeParse(input);
  if (!parsed.success) return failure("invalid");
  const command = parsed.data;
  if (!workspace.sites.some(({ id, canManage }) => id === command.siteId && canManage)) {
    return failure("unavailable");
  }
  const current = { ...workspace, custody: workspace.custody ?? emptyCustodyWorkspace() };
  if (command.type === "saveCustodian") return saveCustodian(current, command);
  if (command.type === "noteCustodian") return noteCustodian(current, command, actor);
  const audit = { actor, at: new Date().toISOString() };
  if ("assets" in command) return applyBulk(current, command, audit, booking);
  const asset = siteAsset(current, command.siteId, command.assetId);
  if (asset === undefined) return failure("unavailable");
  const result = applySingle(current, asset, command, audit);
  if (result.ok && booking?.(result.value) === false) return failure("held");
  return result;
}
