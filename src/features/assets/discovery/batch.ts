import { z } from "zod";
import type { AssetCommand, AssetModel, AssetRecord, AssetsWorkspace } from "../contracts";
import { applyAssetWorkspaceCommand } from "../registerCommands";
import { assetKey, uniqueAssetKeys } from "../registerRules";
import {
  type AssetRegisterBatchInput,
  type AssetRegisterBatchOutcome,
  type AssetRegisterBatchResult,
  maxAssetRegisterSelection,
} from "./contracts";

const id = z.uuid().toLowerCase();
const editTags = z
  .array(
    z
      .string()
      .trim()
      .min(1)
      .max(40)
      .refine((value) => !value.includes("\u0000")),
  )
  .min(1)
  .max(20)
  .refine(uniqueAssetKeys);
export const assetRegisterBatchInput = z
  .strictObject({
    siteId: id,
    requestId: id,
    selection: z
      .array(z.strictObject({ assetId: id, version: z.number().int().positive() }))
      .min(1)
      .max(maxAssetRegisterSelection),
    intent: z.discriminatedUnion("type", [
      z.strictObject({ type: z.literal("addTags"), tags: editTags }),
      z.strictObject({ type: z.literal("removeTags"), tags: editTags }),
      z.strictObject({ type: z.literal("setCategory"), categoryId: id.nullable() }),
      z.strictObject({ type: z.literal("setModel"), modelId: id.nullable() }),
    ]),
  })
  .refine(
    ({ selection }) => new Set(selection.map(({ assetId }) => assetId)).size === selection.length,
  );

type UpdateCommand = Extract<AssetCommand, { type: "update" }>;
type Candidate =
  | { command: UpdateCommand }
  | { state: "skipped"; reason: "unchanged" | "incompatible" };

type BatchOptions = {
  checkUpdate?: (input: {
    before: AssetsWorkspace;
    after: AssetsWorkspace;
    record: AssetRecord;
    command: UpdateCommand;
  }) => boolean | Promise<boolean>;
};

const invalid = { ok: false, error: "invalid" } as const;
const unavailable = { ok: false, error: "unavailable" } as const;
const unchanged = { state: "skipped", reason: "unchanged" } as const;
const incompatible = { state: "skipped", reason: "incompatible" } as const;

function tagged(record: AssetRecord, type: "addTags" | "removeTags", tags: string[]) {
  const existing = new Set(record.tags.map(assetKey));
  const requested = new Set(tags.map(assetKey));
  return type === "addTags"
    ? [...record.tags, ...tags.filter((tag) => !existing.has(assetKey(tag)))]
    : record.tags.filter((tag) => !requested.has(assetKey(tag)));
}

function inheritedModelFields(record: AssetRecord, model: AssetModel | null) {
  return model !== null && model.categoryId === record.categoryId
    ? { ...model.fieldValues, ...record.fieldValues }
    : record.fieldValues;
}

function candidate(
  record: AssetRecord,
  { intent, requestId }: AssetRegisterBatchInput,
  model: AssetModel | null,
): Candidate {
  const individual = record.tracking === "individual" ? record : null;
  const command: UpdateCommand = {
    type: "update",
    assetId: record.id,
    version: record.version,
    requestId,
    code: record.code,
    name: record.name,
    description: record.description,
    categoryId: record.categoryId,
    tags: record.tags,
    fieldValues: record.fieldValues,
    serial: individual?.serial ?? null,
    modelId: individual?.modelId ?? null,
  };
  switch (intent.type) {
    case "addTags":
    case "removeTags": {
      const tags = tagged(record, intent.type, intent.tags);
      if (tags.length === record.tags.length) return unchanged;
      if (tags.length > 20) return incompatible;
      return { command: { ...command, tags } };
    }
    case "setCategory":
      return record.categoryId === intent.categoryId
        ? unchanged
        : { command: { ...command, categoryId: intent.categoryId } };
    case "setModel":
      if (individual === null) return incompatible;
      if (individual.modelId === intent.modelId) return unchanged;
      return {
        command: {
          ...command,
          modelId: intent.modelId,
          fieldValues: inheritedModelFields(record, model),
        },
      };
  }
}

function describeModelChange(
  workspace: AssetsWorkspace,
  record: AssetRecord,
  model: AssetModel | null,
): AssetsWorkspace {
  if (record.tracking !== "individual") return workspace;
  const original = workspace.models.find(({ id }) => id === record.modelId);
  const reason = `${original?.code ?? "—"} → ${model?.code ?? "—"}`;
  return {
    ...workspace,
    records: workspace.records.map((item) => {
      if (item.id !== record.id) return item;
      const [event, ...history] = item.events;
      return event === undefined ? item : { ...item, events: [{ ...event, reason }, ...history] };
    }),
  };
}

async function applySelectedRecord(
  workspace: AssetsWorkspace,
  { assetId, version }: AssetRegisterBatchInput["selection"][number],
  {
    input,
    model,
    actorName,
    checkUpdate,
  }: BatchOptions & {
    input: AssetRegisterBatchInput;
    model: AssetModel | null;
    actorName: string;
  },
) {
  const keep = (details: Omit<AssetRegisterBatchOutcome, "assetId">) => ({
    workspace,
    outcome: { assetId, ...details },
  });
  const record = workspace.records.find(({ id }) => id === assetId);
  if (record === undefined || record.siteId !== input.siteId || record.archivedAt !== null)
    return keep({ state: "unavailable", reason: "unavailable" });
  if (record.version !== version) return keep({ state: "conflict", reason: "stale" });
  const planned = candidate(record, input, model);
  if ("state" in planned) return keep(planned);
  const { command } = planned;
  const updated = applyAssetWorkspaceCommand(workspace, command, actorName);
  if (!updated.ok)
    return keep(
      updated.error === "invalid" ? incompatible : { state: "conflict", reason: "protected" },
    );
  const before = workspace;
  const after = updated.value;
  if ((await checkUpdate?.({ before, after, record, command })) === false)
    return keep({ state: "conflict", reason: "protected" });
  return {
    workspace: input.intent.type === "setModel" ? describeModelChange(after, record, model) : after,
    outcome: { assetId, state: "applied", reason: "changed" } satisfies AssetRegisterBatchOutcome,
  };
}

export async function applyAssetRegisterBatch(
  workspace: AssetsWorkspace,
  raw: AssetRegisterBatchInput,
  actorName: string,
  options: BatchOptions = {},
): Promise<AssetRegisterBatchResult> {
  const parsed = assetRegisterBatchInput.safeParse(raw);
  if (!parsed.success) return invalid;
  const input = parsed.data;
  const { siteId, intent } = input;
  if (!workspace.sites.some(({ id, canManage }) => id === siteId && canManage)) return unavailable;
  if (
    intent.type === "setCategory" &&
    intent.categoryId !== null &&
    !workspace.categories.some(
      ({ id, siteId: scope }) => scope === siteId && id === intent.categoryId,
    )
  )
    return unavailable;
  const model =
    intent.type === "setModel" && intent.modelId !== null
      ? workspace.models.find(({ id, siteId: scope }) => scope === siteId && id === intent.modelId)
      : null;
  if (model === undefined) return unavailable;
  let current = workspace;
  const outcomes: AssetRegisterBatchOutcome[] = [];
  for (const selection of input.selection) {
    const applied = await applySelectedRecord(current, selection, {
      input,
      model,
      actorName,
      ...options,
    });
    current = applied.workspace;
    outcomes.push(applied.outcome);
  }
  return { ok: true, workspace: current, outcomes };
}
