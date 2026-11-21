import {
  type AssetBalance,
  type AssetCategory,
  type AssetCommand,
  type AssetError,
  type AssetEvent,
  type AssetModel,
  type AssetRecord,
  type AssetResult,
  type AssetsWorkspace,
  assetCommand,
} from "./contracts";
import { kitUsesAsset } from "./kits/usage";
import { assetKey, resolveAssetValues, uniqueAssetKeys, validAssetFields } from "./registerRules";

type RecordCommand = Extract<AssetCommand, { assetId: string }>;
type Metadata = Pick<
  AssetModel,
  "code" | "name" | "description" | "categoryId" | "tags" | "fieldValues"
>;
type EventDraft = Pick<AssetEvent, "kind"> &
  Partial<Pick<AssetEvent, "reason" | "fromLocationId" | "locationId" | "quantity">>;

function fail(error: AssetError): AssetResult {
  return { ok: false, error };
}

function done(value: AssetsWorkspace, focusId: string | null = null): AssetResult {
  return { ok: true, value, focusId };
}

function saveRecord(workspace: AssetsWorkspace, asset: AssetRecord): AssetResult {
  return done(
    {
      ...workspace,
      records: workspace.records.map((record) => (record.id === asset.id ? asset : record)),
    },
    asset.id,
  );
}

function activeLocation(workspace: AssetsWorkspace, siteId: string, id: string): boolean {
  return workspace.locations.some(
    (entry) => entry.id === id && entry.siteId === siteId && !entry.archived,
  );
}

function closestCategory(workspace: AssetsWorkspace, siteId: string, id: string | null) {
  return id === null
    ? null
    : workspace.categories.find((entry) => entry.id === id && entry.siteId === siteId);
}

function metadata(workspace: AssetsWorkspace, siteId: string, input: Metadata): Metadata | null {
  const { code, name, description, categoryId, tags, fieldValues } = input;
  const category = closestCategory(workspace, siteId, categoryId);
  if (category === undefined || !uniqueAssetKeys(tags)) return null;
  const values = resolveAssetValues(category, fieldValues);
  return values === null
    ? null
    : { code, name, description, categoryId, tags, fieldValues: values };
}

type MakeEvent = (draft: EventDraft) => AssetEvent;

function eventFor(actor: string): MakeEvent {
  const at = new Date().toISOString();
  return ({ kind, reason, fromLocationId, locationId, quantity }) => ({
    id: crypto.randomUUID(),
    actor,
    at,
    kind,
    reason: reason ?? null,
    fromLocationId: fromLocationId ?? null,
    locationId: locationId ?? null,
    quantity: quantity ?? null,
  });
}

function append(asset: AssetRecord, event: AssetEvent): AssetRecord {
  return { ...asset, version: asset.version + 1, events: [event, ...asset.events] };
}

function existingIdentity(
  workspace: AssetsWorkspace,
  siteId: string,
  code: string,
  serial: string | null,
  except?: string,
): boolean {
  return workspace.records.some(
    (record) =>
      record.id !== except &&
      record.siteId === siteId &&
      (assetKey(record.code) === assetKey(code) ||
        (serial !== null &&
          record.tracking === "individual" &&
          record.serial !== null &&
          assetKey(record.serial) === assetKey(serial))),
  );
}

function registeredModel(workspace: AssetsWorkspace, siteId: string, id: string | null) {
  return id === null
    ? null
    : workspace.models.find((model) => model.id === id && model.siteId === siteId);
}

function createRecord(
  workspace: AssetsWorkspace,
  command: Extract<AssetCommand, { type: "create" }>,
  event: MakeEvent,
) {
  const { siteId, locationId, tracking, openingQuantity, modelId, serial } = command;
  const value = metadata(workspace, siteId, command);
  if (value === null || registeredModel(workspace, siteId, modelId) === undefined)
    return fail("invalid");
  if (locationId !== null && !activeLocation(workspace, siteId, locationId))
    return fail("unavailable");
  if (existingIdentity(workspace, siteId, value.code, serial)) return fail("conflict");
  const isIndividual = tracking === "individual";
  if (
    isIndividual
      ? openingQuantity !== 0
      : serial !== null || modelId !== null || (openingQuantity > 0 && locationId === null)
  )
    return fail("invalid");
  const base = {
    ...value,
    id: crypto.randomUUID(),
    siteId,
    version: 1,
    archivedAt: null,
    events: [
      event({ kind: "created", locationId, quantity: isIndividual ? null : openingQuantity }),
    ],
  };
  const record: AssetRecord = isIndividual
    ? { ...base, tracking, serial, modelId, locationId }
    : {
        ...base,
        tracking,
        balances:
          locationId === null || openingQuantity === 0
            ? []
            : [{ locationId, quantity: openingQuantity }],
      };
  return done({ ...workspace, records: [...workspace.records, record] }, record.id);
}

function createFleet(
  workspace: AssetsWorkspace,
  command: Extract<AssetCommand, { type: "createFleet" }>,
  event: MakeEvent,
) {
  const { siteId, locationId, units, modelId } = command;
  const model = registeredModel(workspace, siteId, modelId);
  if (model == null || (locationId !== null && !activeLocation(workspace, siteId, locationId))) {
    return fail("unavailable");
  }
  if (
    !uniqueAssetKeys(units.map((unit) => unit.code)) ||
    !uniqueAssetKeys(units.flatMap((unit) => (unit.serial === null ? [] : [unit.serial]))) ||
    units.some((unit) => existingIdentity(workspace, siteId, unit.code, unit.serial))
  ) {
    return fail("conflict");
  }
  const records = units.map(
    ({ code, serial }): AssetRecord => ({
      ...model,
      id: crypto.randomUUID(),
      tracking: "individual",
      version: 1,
      archivedAt: null,
      code,
      serial,
      modelId,
      locationId,
      events: [event({ kind: "created", locationId })],
    }),
  );
  return done({ ...workspace, records: [...workspace.records, ...records] }, records[0]?.id);
}

function saveCategory(
  workspace: AssetsWorkspace,
  command: Extract<AssetCommand, { type: "saveCategory" }>,
) {
  const { siteId, categoryId, version, name, fields } = command;
  const original = closestCategory(workspace, siteId, categoryId);
  if (original === undefined) return fail("unavailable");
  if ((original?.version ?? null) !== version) return fail("stale");
  if (!validAssetFields(fields)) return fail("invalid");
  const category: AssetCategory = {
    id: original?.id ?? crypto.randomUUID(),
    siteId,
    version: (original?.version ?? 0) + 1,
    name,
    fields,
  };
  if (
    workspace.categories.some(
      (entry) =>
        entry.siteId === siteId &&
        entry.id !== category.id &&
        assetKey(entry.name) === assetKey(name),
    )
  )
    return fail("conflict");
  if (
    original !== null &&
    (original.fields.some((field) =>
      fields.some((next) => field.id === next.id && field.type !== next.type),
    ) ||
      [...workspace.records, ...workspace.models].some(
        (entry) =>
          entry.categoryId === category.id &&
          resolveAssetValues(category, entry.fieldValues) === null,
      ))
  )
    return fail("state");
  return done({
    ...workspace,
    categories: [...workspace.categories.filter((entry) => entry.id !== category.id), category],
  });
}

function saveModel(
  workspace: AssetsWorkspace,
  command: Extract<AssetCommand, { type: "saveModel" }>,
) {
  const { siteId, modelId, version } = command;
  const original = registeredModel(workspace, siteId, modelId);
  if (original === undefined) return fail("unavailable");
  if ((original?.version ?? null) !== version) return fail("stale");
  const value = metadata(workspace, siteId, command);
  if (value === null) return fail("invalid");
  if (
    workspace.models.some(
      (model) =>
        model.id !== modelId &&
        model.siteId === siteId &&
        assetKey(model.code) === assetKey(value.code),
    )
  )
    return fail("conflict");
  const model: AssetModel = {
    ...value,
    id: original?.id ?? crypto.randomUUID(),
    siteId,
    version: (original?.version ?? 0) + 1,
  };
  return done({
    ...workspace,
    models: [...workspace.models.filter(({ id }) => id !== model.id), model],
  });
}

function update(
  workspace: AssetsWorkspace,
  asset: AssetRecord,
  command: Extract<RecordCommand, { type: "update" }>,
  event: MakeEvent,
) {
  const { serial, modelId } = command;
  const values = metadata(workspace, asset.siteId, command);
  if (values === null || registeredModel(workspace, asset.siteId, modelId) === undefined)
    return fail("invalid");
  if (asset.tracking !== "individual" && (serial !== null || modelId !== null))
    return fail("invalid");
  if (existingIdentity(workspace, asset.siteId, values.code, serial, asset.id))
    return fail("conflict");
  return saveRecord(
    workspace,
    append(
      asset.tracking === "individual"
        ? { ...asset, ...values, serial, modelId }
        : { ...asset, ...values },
      event({ kind: "updated" }),
    ),
  );
}

function placement(asset: AssetRecord): string[] {
  return asset.tracking === "individual"
    ? asset.locationId === null
      ? []
      : [asset.locationId]
    : asset.balances.map(({ locationId }) => locationId);
}

function changeArchive(
  workspace: AssetsWorkspace,
  asset: AssetRecord,
  archived: boolean,
  reason: string,
  event: MakeEvent,
) {
  if (archived === (asset.archivedAt !== null)) return fail("state");
  if (!archived && placement(asset).some((id) => !activeLocation(workspace, asset.siteId, id))) {
    return fail("state");
  }
  const activity = event({ kind: archived ? "archived" : "reinstated", reason });
  return saveRecord(
    workspace,
    append({ ...asset, archivedAt: archived ? activity.at : null }, activity),
  );
}

function withBalance(
  balances: AssetBalance[],
  locationId: string,
  quantity: number,
): AssetBalance[] {
  const others = balances.filter((entry) => entry.locationId !== locationId);
  return quantity === 0 ? others : [...others, { locationId, quantity }];
}

type Pool = Extract<AssetRecord, { balances: AssetBalance[] }>;
type PoolCommand = Extract<RecordCommand, { type: "changePool" }>;

function movePool(
  workspace: AssetsWorkspace,
  asset: Pool,
  command: PoolCommand,
  source: number,
  event: MakeEvent,
) {
  const { locationId, toLocationId, quantity, reason } = command;
  if (toLocationId === null || toLocationId === locationId) return fail("invalid");
  if (!activeLocation(workspace, asset.siteId, toLocationId)) return fail("unavailable");
  const destination =
    asset.balances.find((entry) => entry.locationId === toLocationId)?.quantity ?? 0;
  if (source < quantity || destination + quantity > 1_000_000) return fail("stock");
  const balances = withBalance(
    withBalance(asset.balances, locationId, source - quantity),
    toLocationId,
    destination + quantity,
  );
  return saveRecord(
    workspace,
    append(
      { ...asset, balances },
      event({
        kind: "moved",
        fromLocationId: locationId,
        locationId: toLocationId,
        quantity,
        reason,
      }),
    ),
  );
}

function changePool(
  workspace: AssetsWorkspace,
  asset: AssetRecord,
  command: PoolCommand,
  event: MakeEvent,
) {
  const { operation, locationId, toLocationId, quantity, reason } = command;
  if (
    asset.tracking === "individual" ||
    (operation === "consume" && asset.tracking !== "consumable_pool") ||
    (quantity === 0 && operation !== "adjust")
  )
    return fail("invalid");
  if (!activeLocation(workspace, asset.siteId, locationId)) return fail("unavailable");
  const source = asset.balances.find((entry) => entry.locationId === locationId)?.quantity ?? 0;
  if (operation === "move") return movePool(workspace, asset, command, source, event);
  if (toLocationId !== null) return fail("invalid");
  const next =
    operation === "adjust"
      ? quantity
      : operation === "restock"
        ? source + quantity
        : source - quantity;
  if (next < 0 || next > 1_000_000) return fail("stock");
  if (next === source) return fail("state");
  const kind =
    operation === "restock" ? "restocked" : operation === "consume" ? "consumed" : "adjusted";
  return saveRecord(
    workspace,
    append(
      {
        ...asset,
        balances: withBalance(asset.balances, locationId, next),
      },
      event({ kind, locationId, quantity: next - source, reason }),
    ),
  );
}

function changeRecord(
  workspace: AssetsWorkspace,
  asset: AssetRecord,
  command: RecordCommand,
  event: MakeEvent,
): AssetResult {
  if (asset.version !== command.version) return fail("stale");
  if (
    (command.type === "move" || (command.type === "setArchive" && command.archived)) &&
    (workspace.custody?.holdings.some(({ assetId }) => assetId === asset.id) === true ||
      kitUsesAsset(workspace.kits, asset.id))
  )
    return fail("state");
  if (command.type === "setArchive")
    return changeArchive(workspace, asset, command.archived, command.reason, event);
  if (asset.archivedAt !== null) return fail("state");
  if (
    command.type === "update" &&
    asset.tracking === "individual" &&
    (command.modelId !== asset.modelId || command.serial !== asset.serial) &&
    kitUsesAsset(workspace.kits, asset.id)
  )
    return fail("state");
  switch (command.type) {
    case "note":
      return saveRecord(workspace, append(asset, event({ kind: "note", reason: command.reason })));
    case "update":
      return update(workspace, asset, command, event);
    case "move":
      if (asset.tracking !== "individual") return fail("invalid");
      if (
        command.locationId !== null &&
        !activeLocation(workspace, asset.siteId, command.locationId)
      ) {
        return fail("unavailable");
      }
      if (asset.locationId === command.locationId) return fail("state");
      return saveRecord(
        workspace,
        append(
          { ...asset, locationId: command.locationId },
          event({
            kind: "moved",
            reason: command.reason,
            fromLocationId: asset.locationId,
            locationId: command.locationId,
          }),
        ),
      );
    case "changePool":
      return changePool(workspace, asset, command, event);
  }
}

export function applyAssetWorkspaceCommand(
  workspace: AssetsWorkspace,
  input: AssetCommand,
  actor: string,
): AssetResult {
  const parsed = assetCommand.safeParse(input);
  if (!parsed.success) return fail("invalid");
  const command = parsed.data;
  const event = eventFor(actor);
  if ("assetId" in command) {
    const asset = workspace.records.find(({ id }) => id === command.assetId);
    if (
      asset === undefined ||
      !workspace.sites.some((site) => site.id === asset.siteId && site.canManage)
    ) {
      return fail("unavailable");
    }
    return changeRecord(workspace, asset, command, event);
  }
  if (!workspace.sites.some((site) => site.id === command.siteId && site.canManage))
    return fail("unavailable");
  switch (command.type) {
    case "create":
      return createRecord(workspace, command, event);
    case "createFleet":
      return createFleet(workspace, command, event);
    case "saveCategory":
      return saveCategory(workspace, command);
    case "saveModel":
      return saveModel(workspace, command);
  }
}
