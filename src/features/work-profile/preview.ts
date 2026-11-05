import type { Db } from "@/db/client";
import { workCatalog } from "./catalog";
import type { Preset, Preview, WorkCommand } from "./contracts";
import { fail } from "./errors";
import { type NativeState, nativeState } from "./install-state";
import { readProfile } from "./read";
import { fingerprint } from "./storage";
export type PreviewInput = Extract<WorkCommand, { action: "preview" }>;
type Operation = Preview["operations"][number];

function operation(
  resource: Pick<Operation, "kind" | "key" | "name">,
  exists: boolean,
  compatible: boolean,
  reason: string,
): Operation {
  if (!exists) return { ...resource, disposition: "create" };
  if (compatible) return { ...resource, disposition: "reuse" };
  return { ...resource, disposition: "conflict", reason };
}

function salesOperation(preset: Preset, state: NativeState, name: string): Operation {
  const matches = state.pipelines.filter(
    (pipeline) => pipeline.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
  );
  const [existing] = matches;
  const compatible =
    matches.length === 1 &&
    existing !== undefined &&
    !existing.isArchived &&
    existing.visibilityGroupId === null &&
    existing.stages.length === preset.sales.stages.length &&
    existing.stages.every(
      (stage, index) =>
        stage.name === preset.sales.stages[index] &&
        stage.order === index &&
        stage.rottingDays === null,
    );
  return operation(
    { kind: "pipeline", key: `wp_${preset.id}_sales_v${preset.version}`, name },
    existing !== undefined,
    compatible,
    "A pipeline with this name has different settings.",
  );
}

function deliveryOperation(preset: Preset, state: NativeState, name: string): Operation {
  const key = `wp_${preset.id}_delivery_v${preset.version}`;
  const existing = state.types.find((type) => type.key === key);
  const compatible =
    existing !== undefined &&
    !existing.isArchived &&
    existing.name === name &&
    fingerprint(existing.fields) === fingerprint(preset.delivery.fields) &&
    fingerprint(existing.stages.map(({ key, name, bucket }) => ({ key, name, bucket }))) ===
      fingerprint(preset.delivery.stages);
  return operation(
    { kind: "work_type", key, name },
    existing !== undefined,
    compatible,
    "The installed delivery configuration differs.",
  );
}

function fieldOperation(field: Preset["dealFields"][number], state: NativeState): Operation {
  const existing = state.fields.find(
    (value) => value.targetEntity === "deal" && value.key === field.key,
  );
  const compatible =
    existing !== undefined &&
    existing.archivedAt === null &&
    existing.type === field.type &&
    existing.name === field.name &&
    !existing.isRequired &&
    !existing.isImportant &&
    existing.showInAddForm &&
    existing.options.length === 0;
  return operation(
    { kind: "deal_field", key: field.key, name: field.name },
    existing !== undefined,
    compatible,
    "A field with this key has different settings.",
  );
}

function activityOperation(
  activity: Preset["activityTypes"][number],
  state: NativeState,
): Operation {
  const existing = state.activities.find((value) => value.key === activity.key);
  const compatible =
    existing !== undefined &&
    existing.archivedAt === null &&
    !existing.isSystem &&
    existing.name === activity.name &&
    existing.icon === activity.icon;
  return operation(
    { kind: "activity_type", key: activity.key, name: activity.name },
    existing !== undefined,
    compatible,
    "An activity type with this key has different settings.",
  );
}

export function buildPreview(input: PreviewInput, state: NativeState): Preview {
  const preset = workCatalog(input.locale).find((value) => value.id === input.presetId);
  if (!preset) fail("invalid_input");
  const salesName = input.salesName ?? preset.sales.name;
  const deliveryName = input.deliveryName ?? preset.delivery.name;
  const operations: Operation[] = [];
  if (input.selection.sales) operations.push(salesOperation(preset, state, salesName));
  if (input.selection.delivery) operations.push(deliveryOperation(preset, state, deliveryName));
  if (input.selection.dealFields)
    operations.push(...preset.dealFields.map((field) => fieldOperation(field, state)));
  if (input.selection.activityTypes)
    operations.push(...preset.activityTypes.map((activity) => activityOperation(activity, state)));
  const result = {
    presetId: preset.id,
    presetVersion: preset.version,
    expectedRevision: input.expectedRevision,
    locale: input.locale,
    selection: input.selection,
    salesName,
    deliveryName,
    operations,
    conflicts: operations
      .filter((value) => value.disposition === "conflict")
      .map((value) => value.key),
  };
  return { ...result, fingerprint: fingerprint({ result, preset, state }) };
}

export async function preview(db: Db, input: PreviewInput, signal: AbortSignal) {
  const profile = await readProfile(db, signal);
  if (profile.revision !== input.expectedRevision) fail("conflict");
  return buildPreview(input, await nativeState(db, signal));
}
