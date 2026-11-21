import type { AssetEvent, AssetRecord, AssetsWorkspace } from "../contracts";
import { assetKey } from "../registerRules";
import {
  emptyKitWorkspace,
  type Kit,
  type KitActivity,
  type KitCheckout,
  type KitCheckoutLine,
  type KitCommand,
  type KitError,
  type KitMember,
  type KitMemberInput,
  type KitResult,
  type KitReturn,
  type KitWorkspace,
  kitCommand,
} from "./contracts";

type Workspace = AssetsWorkspace & { kits: KitWorkspace };
type Save = Extract<KitCommand, { type: "saveKit" }>;
type Move = Extract<KitCommand, { type: "moveKit" }>;
type Checkout = Extract<KitCommand, { type: "checkoutKit" }>;
type Return = Extract<KitCommand, { type: "returnKit" }>;
type Individual = Extract<AssetRecord, { tracking: "individual" }>;
type Pool = Extract<AssetRecord, { balances: unknown }>;
type Affected = { record: AssetRecord; quantity: number | null };
type Change = {
  workspace: Workspace;
  assets: Map<string, Affected>;
  actor: string;
  at: string;
};
type Effect = {
  kit: Kit;
  kind: KitActivity["kind"];
  fromLocationId: string | null;
  checkout?: KitCheckout;
  returned?: KitReturn;
};

const maxBalance = 1_000_000;

function fail(error: KitError): KitResult {
  return { ok: false, error };
}

function activeLocation(workspace: Workspace, siteId: string, locationId: string) {
  return workspace.locations.some(
    ({ id, siteId: locationSite, archived }) =>
      id === locationId && locationSite === siteId && !archived,
  );
}

function assetAt(change: Change, siteId: string, assetId: string) {
  const record =
    change.assets.get(assetId)?.record ?? change.workspace.records.find(({ id }) => id === assetId);
  return record?.siteId === siteId ? record : undefined;
}

function activeCheckout(workspace: Workspace, kit: Kit) {
  return workspace.kits.checkouts.find(
    ({ siteId, kitId, closedAt }) => siteId === kit.siteId && kitId === kit.id && closedAt === null,
  );
}

function isIndividuallyHeld(workspace: Workspace, asset: Individual) {
  return (
    workspace.custody?.holdings.some(
      ({ siteId, assetId }) => siteId === asset.siteId && assetId === asset.id,
    ) === true
  );
}

function occupiedSlot(
  workspace: Workspace,
  asset: Individual,
  exceptKit?: string,
  exceptLine?: string,
) {
  return workspace.kits.records.some(
    (kit) =>
      kit.siteId === asset.siteId &&
      kit.lines.some(
        ({ id, assetId }) =>
          assetId === asset.id &&
          (kit.id !== exceptKit || (exceptLine !== undefined && id !== exceptLine)),
      ),
  );
}

function checkPackedAsset(workspace: Workspace, kit: Kit, asset: AssetRecord): KitError | null {
  if (asset.archivedAt !== null) return "ineligible";
  if (asset.tracking === "individual") {
    if (isIndividuallyHeld(workspace, asset)) return "held";
    if (asset.locationId !== kit.locationId) return "stale";
  }
  return null;
}

function recordEffect(change: Change, record: AssetRecord, quantity: number | null) {
  const previous = change.assets.get(record.id);
  change.assets.set(record.id, {
    record,
    quantity: quantity === null ? null : (previous?.quantity ?? 0) + quantity,
  });
}

function changeFreeQuantity(change: Change, pool: Pool, locationId: string, delta: number) {
  const current = pool.balances.find((row) => row.locationId === locationId)?.quantity ?? 0;
  const next = current + delta;
  if (next < 0 || next > maxBalance) return false;
  const balances = pool.balances.filter((row) => row.locationId !== locationId);
  if (next > 0) balances.push({ locationId, quantity: next });
  recordEffect(change, { ...pool, balances }, null);
  return true;
}

function unpackPrior(change: Change, kit: Kit): KitError | null {
  for (const line of kit.lines) {
    const asset = assetAt(change, kit.siteId, line.assetId);
    if (asset === undefined) return "unavailable";
    if (line.packedQuantity === 0) continue;
    const error = checkPackedAsset(change.workspace, kit, asset);
    if (error !== null) return error;
    if (asset.tracking === "individual") {
      recordEffect(change, asset, null);
    } else if (!changeFreeQuantity(change, asset, kit.locationId, line.packedQuantity)) {
      return "quantity";
    }
  }
  return null;
}

function individualMatches(workspace: Workspace, asset: Individual, line: KitMemberInput) {
  if (line.quantity !== 1) return false;
  if (line.mode === "individual") return line.modelId === null;
  return (
    line.mode === "model" &&
    line.modelId !== null &&
    asset.modelId === line.modelId &&
    workspace.models.some(({ id, siteId }) => id === line.modelId && siteId === asset.siteId)
  );
}

function packIndividual(
  change: Change,
  asset: Individual,
  line: KitMemberInput,
  save: Save,
  selected: Set<string>,
): KitError | null {
  if (!individualMatches(change.workspace, asset, line)) return "ineligible";
  if (selected.has(asset.id)) return "conflict";
  if (isIndividuallyHeld(change.workspace, asset)) return "held";
  if (occupiedSlot(change.workspace, asset, save.kitId ?? undefined)) return "conflict";
  if (line.sourceLocationId !== null && line.sourceLocationId !== asset.locationId) return "stale";
  if (asset.locationId !== null && !activeLocation(change.workspace, save.siteId, asset.locationId))
    return "unavailable";
  selected.add(asset.id);
  recordEffect(change, { ...asset, locationId: save.locationId }, null);
  return null;
}

function packPool(change: Change, asset: Pool, line: KitMemberInput, siteId: string) {
  if (line.mode !== asset.tracking || line.modelId !== null) return "ineligible";
  if (line.sourceLocationId === null) return "invalid";
  if (!activeLocation(change.workspace, siteId, line.sourceLocationId)) return "unavailable";
  return changeFreeQuantity(change, asset, line.sourceLocationId, -line.quantity)
    ? null
    : "quantity";
}

function packLines(change: Change, command: Save): KitMember[] | KitError {
  const result: KitMember[] = [];
  const selected = new Set<string>();
  for (const line of command.lines) {
    const asset = assetAt(change, command.siteId, line.assetId);
    if (asset === undefined) return "unavailable";
    if (asset.archivedAt !== null) return "ineligible";
    const error =
      asset.tracking === "individual"
        ? packIndividual(change, asset, line, command, selected)
        : packPool(change, asset, line, command.siteId);
    if (error !== null) return error;
    result.push({ ...line, id: crypto.randomUUID(), packedQuantity: line.quantity });
  }
  return result;
}

function saveKit(change: Change, command: Save, prior: Kit | undefined): Effect | KitError {
  const { workspace } = change;
  if ((prior?.version ?? null) !== command.version) return "stale";
  if (prior !== undefined && activeCheckout(workspace, prior) !== undefined) return "held";
  if (!activeLocation(workspace, command.siteId, command.locationId)) return "unavailable";
  if (
    workspace.kits.records.some(
      ({ id, siteId, code }) =>
        id !== prior?.id && siteId === command.siteId && assetKey(code) === assetKey(command.code),
    )
  )
    return "conflict";
  if (prior !== undefined) {
    if (!activeLocation(workspace, prior.siteId, prior.locationId)) return "unavailable";
    const error = unpackPrior(change, prior);
    if (error !== null) return error;
  }
  const lines = packLines(change, command);
  if (typeof lines === "string") return lines;
  const { siteId, code, name, locationId } = command;
  return {
    kit: {
      id: prior?.id ?? crypto.randomUUID(),
      siteId,
      code,
      name,
      locationId,
      version: (prior?.version ?? 0) + 1,
      definitionVersion: (prior?.definitionVersion ?? 0) + 1,
      lines,
    },
    kind: prior === undefined ? "created" : "edited",
    fromLocationId: prior?.locationId ?? null,
  };
}

function moveKit(change: Change, kit: Kit, command: Move): Effect | KitError {
  if (activeCheckout(change.workspace, kit) !== undefined) return "held";
  if (command.locationId === kit.locationId) return "conflict";
  if (!activeLocation(change.workspace, kit.siteId, command.locationId)) return "unavailable";
  for (const line of kit.lines) {
    if (line.packedQuantity === 0) continue;
    const asset = assetAt(change, kit.siteId, line.assetId);
    if (asset === undefined) return "unavailable";
    const error = checkPackedAsset(change.workspace, kit, asset);
    if (error !== null) return error;
    const relocated =
      asset.tracking === "individual" ? { ...asset, locationId: command.locationId } : asset;
    recordEffect(change, relocated, line.packedQuantity);
  }
  return {
    kit: { ...kit, locationId: command.locationId, version: kit.version + 1 },
    kind: "moved",
    fromLocationId: kit.locationId,
  };
}

function eligibleCustodian(workspace: Workspace, siteId: string, custodianId: string) {
  const roster = workspace.custody;
  const person = roster?.custodians.find(
    ({ id, siteId: custodianSite, active }) =>
      id === custodianId && custodianSite === siteId && active,
  );
  if (person === undefined) return undefined;
  if (person.kind === "non_login") return person;
  const staff = roster?.staff.find(({ id }) => id === person.staffId);
  return staff === undefined ? undefined : { ...person, name: staff.name };
}

function selectAlternate(
  change: Change,
  kit: Kit,
  line: KitMember,
  source: Individual,
  replacement: string,
): Individual | KitError {
  if (line.mode !== "model") return "ineligible";
  const found = assetAt(change, kit.siteId, replacement);
  if (found === undefined) return "unavailable";
  if (
    found.tracking !== "individual" ||
    found.archivedAt !== null ||
    !individualMatches(change.workspace, found, line)
  )
    return "ineligible";
  if (isIndividuallyHeld(change.workspace, found)) return "held";
  if (occupiedSlot(change.workspace, found, kit.id, line.id)) return "conflict";
  if (found.locationId !== null && !activeLocation(change.workspace, kit.siteId, found.locationId))
    return "unavailable";
  recordEffect(change, source, 1);
  return { ...found, locationId: kit.locationId };
}

function checkoutAsset(
  change: Change,
  kit: Kit,
  line: KitMember,
  replacement: string | undefined,
): AssetRecord | KitError {
  const asset = assetAt(change, kit.siteId, line.assetId);
  if (asset === undefined) return "unavailable";
  const error = checkPackedAsset(change.workspace, kit, asset);
  if (error !== null) return error;
  if (asset.tracking !== "individual") {
    if (replacement !== undefined || line.mode !== asset.tracking) return "ineligible";
    return asset;
  }
  if (replacement !== undefined && line.mode !== "model") return "ineligible";
  if (!individualMatches(change.workspace, asset, line)) return "ineligible";
  return replacement === undefined || replacement === asset.id
    ? asset
    : selectAlternate(change, kit, line, asset, replacement);
}

function issueKitLines(
  change: Change,
  kit: Kit,
  replacements: Checkout["replacements"],
): { snapshot: KitCheckoutLine[]; packed: KitMember[] } | KitError {
  const choices = new Map(replacements.map(({ lineId, assetId }) => [lineId, assetId]));
  if (replacements.some(({ lineId }) => !kit.lines.some(({ id }) => id === lineId)))
    return "invalid";
  const snapshot: KitCheckoutLine[] = [];
  const packed: KitMember[] = [];
  const individuals = new Set<string>();
  for (const line of kit.lines) {
    const asset = checkoutAsset(change, kit, line, choices.get(line.id));
    if (typeof asset === "string") return asset;
    if (asset.tracking === "individual") {
      if (individuals.has(asset.id)) return "conflict";
      individuals.add(asset.id);
    }
    recordEffect(change, asset, line.packedQuantity);
    snapshot.push({
      id: line.id,
      mode: line.mode,
      requestedAssetId: line.assetId,
      assetId: asset.id,
      assetCode: asset.code,
      assetName: asset.name,
      serial: asset.tracking === "individual" ? asset.serial : null,
      modelId: line.mode === "model" ? line.modelId : null,
      sourceLocationId: kit.locationId,
      quantity: line.packedQuantity,
      returned: 0,
      consumed: 0,
    });
    packed.push({ ...line, assetId: asset.id, packedQuantity: 0 });
  }
  return { snapshot, packed };
}

function checkoutKit(change: Change, kit: Kit, command: Checkout): Effect | KitError {
  const { workspace, actor, at } = change;
  if (activeCheckout(workspace, kit) !== undefined) return "held";
  if (!activeLocation(workspace, kit.siteId, kit.locationId)) return "unavailable";
  if (kit.lines.length === 0) return "ineligible";
  if (kit.lines.some(({ packedQuantity, quantity }) => packedQuantity !== quantity))
    return "quantity";
  const holder = eligibleCustodian(workspace, kit.siteId, command.custodianId);
  if (holder === undefined) return "unavailable";
  const issued = issueKitLines(change, kit, command.replacements);
  if (typeof issued === "string") return issued;
  const { id, siteId, code, name, definitionVersion, locationId } = kit;
  return {
    kit: { ...kit, version: kit.version + 1, lines: issued.packed },
    kind: "checked_out",
    fromLocationId: locationId,
    checkout: {
      id: crypto.randomUUID(),
      kitId: id,
      siteId,
      definitionVersion,
      locationId,
      kitCode: code,
      kitName: name,
      custodianId: holder.id,
      custodianName: holder.name,
      actor,
      at,
      closedAt: null,
      note: command.note,
      lines: issued.snapshot,
    },
  };
}

function settleLine(
  change: Change,
  kit: Kit,
  packed: KitMember,
  expected: KitCheckoutLine,
  entry: Return["lines"][number],
): { packed: KitMember; snapshot: KitCheckoutLine } | KitError {
  const { returned, consumed } = entry;
  if (consumed > 0 && expected.mode !== "consumable_pool") return "invalid";
  if (
    returned + consumed > expected.quantity - expected.returned - expected.consumed ||
    packed.packedQuantity + returned > packed.quantity
  )
    return "quantity";
  const asset = assetAt(change, kit.siteId, expected.assetId);
  if (asset === undefined) return "unavailable";
  if (asset.archivedAt !== null || packed.assetId !== asset.id) return "ineligible";
  const landed = asset.tracking === "individual" ? { ...asset, locationId: kit.locationId } : asset;
  recordEffect(change, landed, returned + consumed);
  return {
    packed: { ...packed, packedQuantity: packed.packedQuantity + returned },
    snapshot: {
      ...expected,
      returned: expected.returned + returned,
      consumed: expected.consumed + consumed,
    },
  };
}

function settleKitLines(change: Change, kit: Kit, checkout: KitCheckout, entries: Return["lines"]) {
  const packed = new Map(kit.lines.map((line) => [line.id, line]));
  const snapshot = new Map(checkout.lines.map((line) => [line.id, line]));
  for (const entry of entries) {
    const line = snapshot.get(entry.lineId);
    const member = packed.get(entry.lineId);
    if (line === undefined || member === undefined) return "invalid" as const;
    const effect = settleLine(change, kit, member, line, entry);
    if (typeof effect === "string") return effect;
    packed.set(entry.lineId, effect.packed);
    snapshot.set(entry.lineId, effect.snapshot);
  }
  return { packed: [...packed.values()], snapshot: [...snapshot.values()] };
}

function returnKit(change: Change, kit: Kit, command: Return): Effect | KitError {
  const checkout = activeCheckout(change.workspace, kit);
  if (checkout === undefined || checkout.id !== command.checkoutId) return "unavailable";
  if (!activeLocation(change.workspace, kit.siteId, kit.locationId)) return "unavailable";
  const prepared = settleKitLines(change, kit, checkout, command.lines);
  if (typeof prepared === "string") return prepared;
  const closed = prepared.snapshot.every(
    ({ quantity, returned, consumed }) => quantity === returned + consumed,
  );
  return {
    kit: { ...kit, version: kit.version + 1, lines: prepared.packed },
    kind: "returned",
    fromLocationId: checkout.locationId,
    checkout: { ...checkout, lines: prepared.snapshot, closedAt: closed ? change.at : null },
    returned: {
      id: crypto.randomUUID(),
      siteId: kit.siteId,
      kitId: kit.id,
      checkoutId: checkout.id,
      actor: change.actor,
      at: change.at,
      condition: command.condition,
      note: command.note,
      lines: command.lines,
    },
  };
}

function applyExisting(
  change: Change,
  command: Exclude<KitCommand, Save>,
  kit: Kit | undefined,
): Effect | KitError {
  if (kit === undefined) return "unavailable";
  if (kit.version !== command.version) return "stale";
  switch (command.type) {
    case "moveKit":
      return moveKit(change, kit, command);
    case "checkoutKit":
      return checkoutKit(change, kit, command);
    case "returnKit":
      return returnKit(change, kit, command);
  }
}

function put<T extends { id: string }>(rows: T[], changed: T | undefined) {
  if (changed === undefined) return rows;
  const found = rows.some(({ id }) => id === changed.id);
  return found ? rows.map((row) => (row.id === changed.id ? changed : row)) : [changed, ...rows];
}

function recordActivity(change: Change, effect: Effect, note: string | null): KitResult {
  const { workspace, assets, actor, at } = change;
  const { kit, kind, fromLocationId, checkout, returned } = effect;
  const history: KitActivity = {
    id: crypto.randomUUID(),
    siteId: kit.siteId,
    kitId: kit.id,
    kind,
    version: kit.version,
    actor,
    at,
    note,
    fromLocationId,
    locationId: kit.locationId,
  };
  const records = workspace.records.map((row) => {
    const mutation = assets.get(row.id);
    if (mutation === undefined) return row;
    const event: AssetEvent = {
      id: crypto.randomUUID(),
      kind: kind === "moved" ? "moved" : "updated",
      actor,
      at,
      reason: note,
      fromLocationId,
      locationId: kit.locationId,
      quantity: mutation.quantity,
    };
    return { ...mutation.record, version: row.version + 1, events: [event, ...row.events] };
  });
  return {
    ok: true,
    value: {
      ...workspace,
      records,
      kits: {
        records: put(workspace.kits.records, kit),
        checkouts: put(workspace.kits.checkouts, checkout),
        returns: put(workspace.kits.returns, returned),
        history: [history, ...workspace.kits.history],
      },
    },
    kitId: kit.id,
  };
}

export function applyKitCommand(
  workspace: AssetsWorkspace,
  input: KitCommand,
  actor: string,
): KitResult {
  const parsed = kitCommand.safeParse(input);
  if (!parsed.success) return fail("invalid");
  const command = parsed.data;
  if (!workspace.sites.some(({ id, canManage }) => id === command.siteId && canManage))
    return fail("unavailable");
  const current = { ...workspace, kits: workspace.kits ?? emptyKitWorkspace() };
  const prior = current.kits.records.find(
    ({ id, siteId }) => id === command.kitId && siteId === command.siteId,
  );
  if (command.kitId !== null && prior === undefined) return fail("unavailable");
  const change = { workspace: current, assets: new Map(), actor, at: new Date().toISOString() };
  const effect =
    command.type === "saveKit"
      ? saveKit(change, command, prior)
      : applyExisting(change, command, prior);
  return typeof effect === "string" ? fail(effect) : recordActivity(change, effect, command.note);
}
